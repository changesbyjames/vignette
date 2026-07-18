import {
  decodeRuntimeSseEvent,
  type AssetManifest,
  type CompiledSnapshot,
  type RuntimeSseEvent,
} from "@strangecyan/vignette-core";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { LoadedSnapshot } from "./types.js";

interface SnapshotEnvelope {
  readonly snapshot: CompiledSnapshot;
  readonly manifest?: AssetManifest;
}

/** Load a compiled snapshot and its asset locations from JSON, a URL, or a runtime SSE stream. */
export async function loadSnapshot(input: string, timeoutMs: number): Promise<LoadedSnapshot> {
  if (isHttpUrl(input)) return loadRemoteSnapshot(input, timeoutMs);

  const path = input.startsWith("file:") ? fileURLToPath(input) : resolve(input);
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  const envelope = readSnapshotEnvelope(value);
  return {
    snapshot: envelope.snapshot,
    assetUrls: manifestUrls(envelope.manifest, pathToFileURL(path).href),
    localAssetRoot: dirname(path),
  };
}

async function loadRemoteSnapshot(input: string, timeoutMs: number): Promise<LoadedSnapshot> {
  const response = await fetch(input, {
    headers: { accept: "application/json, text/event-stream" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(
      `Snapshot request failed with ${String(response.status)} ${response.statusText}.`,
    );
  }

  const sourceUrl = response.url;
  if (response.headers.get("content-type")?.includes("text/event-stream") === true) {
    const envelope = await readSseSnapshot(response);
    return {
      snapshot: envelope.snapshot,
      assetUrls: manifestUrls(envelope.manifest, sourceUrl),
      assetBaseUrl: new URL(".", sourceUrl).href,
    };
  }

  const envelope = readSnapshotEnvelope((await response.json()) as unknown);
  return {
    snapshot: envelope.snapshot,
    assetUrls: manifestUrls(envelope.manifest, sourceUrl),
    assetBaseUrl: new URL(".", sourceUrl).href,
  };
}

async function readSseSnapshot(response: Response): Promise<SnapshotEnvelope> {
  if (response.body === null) throw new Error("Snapshot SSE response has no body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let manifest: AssetManifest | undefined;

  try {
    for (;;) {
      const next = await reader.read();
      buffer += decoder.decode(next.value, { stream: !next.done });
      let boundary = sseBoundary(buffer);
      while (boundary !== undefined) {
        const record = parseSseRecord(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary.length);
        boundary = sseBoundary(buffer);
        if (record === undefined) continue;
        const message = decodeRuntimeSseEvent(record.event, record.data);
        if (message.kind === "setup") manifest = message.manifest;
        if (message.kind === "update") {
          return {
            snapshot: validateSnapshot(message.snapshot),
            ...(manifest === undefined ? {} : { manifest }),
          };
        }
      }
      if (next.done) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  throw new Error("Snapshot SSE stream ended before its first update.");
}

function parseSseRecord(
  record: string,
): Readonly<{ event: RuntimeSseEvent; data: string }> | undefined {
  let event: RuntimeSseEvent | undefined;
  const data: string[] = [];
  for (const line of record.split(/\r\n|\r|\n/gu)) {
    if (line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    const raw = separator < 0 ? "" : line.slice(separator + 1);
    const value = raw.startsWith(" ") ? raw.slice(1) : raw;
    if (field === "event" && isRuntimeEvent(value)) event = value;
    if (field === "data") data.push(value);
  }
  return event === undefined ? undefined : { event, data: data.join("\n") };
}

function sseBoundary(value: string): Readonly<{ index: number; length: number }> | undefined {
  const match = /(?:\r\n|\r|\n){2}/u.exec(value);
  return match?.index === undefined ? undefined : { index: match.index, length: match[0].length };
}

function readSnapshotEnvelope(value: unknown): SnapshotEnvelope {
  if (!isRecord(value)) throw new TypeError("Snapshot JSON must be an object.");
  if ("snapshot" in value) {
    return {
      snapshot: validateSnapshot(value.snapshot),
      ...(value.manifest === undefined ? {} : { manifest: validateManifest(value.manifest) }),
    };
  }
  return { snapshot: validateSnapshot(value) };
}

function validateSnapshot(value: unknown): CompiledSnapshot {
  if (
    !isRecord(value) ||
    typeof value.revision !== "number" ||
    typeof value.projectId !== "string" ||
    !isRecord(value.canvas) ||
    typeof value.canvas.width !== "number" ||
    typeof value.canvas.height !== "number" ||
    !Array.isArray(value.sources) ||
    !Array.isArray(value.scenes) ||
    !Array.isArray(value.warnings)
  ) {
    throw new TypeError("Input is not a Vignette compiled snapshot.");
  }
  if (value.canvas.width <= 0 || value.canvas.height <= 0) {
    throw new TypeError("Snapshot canvas dimensions must be positive.");
  }
  return value as unknown as CompiledSnapshot;
}

function validateManifest(value: unknown): AssetManifest {
  if (!isRecord(value) || !Array.isArray(value.assets)) {
    throw new TypeError("Snapshot asset manifest is invalid.");
  }
  return value as unknown as AssetManifest;
}

function manifestUrls(
  manifest: AssetManifest | undefined,
  sourceUrl: string,
): Readonly<Record<string, string>> {
  if (manifest === undefined) return {};
  return Object.fromEntries(
    manifest.assets.map((entry) => [entry.name, new URL(entry.url, sourceUrl).href]),
  );
}

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function isRuntimeEvent(value: string): value is RuntimeSseEvent {
  return value === "setup" || value === "update" || value === "event";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
