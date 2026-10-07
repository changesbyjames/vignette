import { z } from "zod";
import { omitUndefined } from "@strangecyan/vignette-core";
import {
  decodeStreamSseEvent,
  CompiledSnapshotWireSchema,
  AssetManifestWireSchema,
  isRootRelativeUrl,
  resolveResourceUrl,
  type AssetManifest,
  type CompiledSnapshot,
  type StreamSseEvent,
} from "@strangecyan/vignette-core";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { LoadedSnapshot } from "./types.js";

interface ParseSseRecord {
  event: StreamSseEvent;
  data: string;
}

interface SseBoundary {
  index: number;
  length: number;
}

interface SnapshotEnvelope {
  readonly snapshot: CompiledSnapshot;
  readonly manifest?: AssetManifest;
}

/**
 * Load a compiled snapshot and its asset locations from JSON, a URL, or a composer stream (SSE).
 * Root-relative URLs resolve against `baseUrl`, else the snapshot URL; a file snapshot containing
 * root-relative URLs requires `baseUrl`.
 */
export async function loadSnapshot(
  input: string,
  timeoutMs: number,
  baseUrl?: string,
): Promise<LoadedSnapshot> {
  if (isHttpUrl(input)) return loadRemoteSnapshot(input, timeoutMs, baseUrl);

  const path = input.startsWith("file:") ? fileURLToPath(input) : resolve(input);
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  const envelope = readSnapshotEnvelope(value);
  return {
    snapshot: requireResolvableUrls(envelope.snapshot, baseUrl),
    assetUrls: manifestUrls(envelope.manifest, baseUrl),
    localAssetRoot: dirname(path),
    ...omitUndefined({ baseUrl }),
  };
}

/** Fetch JSON or the first SSE update, resolving root-relative URLs against the override or response URL. */
async function loadRemoteSnapshot(
  input: string,
  timeoutMs: number,
  baseUrlOverride: string | undefined,
): Promise<LoadedSnapshot> {
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
  const baseUrl = baseUrlOverride ?? sourceUrl;
  const envelope =
    response.headers.get("content-type")?.includes("text/event-stream") === true
      ? await readSseSnapshot(response)
      : readSnapshotEnvelope(await response.json());
  return {
    snapshot: envelope.snapshot,
    assetUrls: manifestUrls(envelope.manifest, baseUrl),
    assetBaseUrl: new URL(".", sourceUrl).href,
    baseUrl,
  };
}

/** Accumulate complete SSE records until a validated update is available, retaining setup manifest data. */
async function readSseSnapshot(response: Response): Promise<SnapshotEnvelope> {
  if (response.body === null) throw new Error("Snapshot SSE response has no body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let manifest: AssetManifest | undefined = undefined;

  try {
    // Accumulate complete SSE records until a validated update is available, retaining setup manifest data.

    for (;;) {
      // Accumulate complete SSE records until a validated update is available, retaining setup manifest data.

      const next = await reader.read();
      buffer += decoder.decode(next.value, { stream: !next.done });
      let boundary = sseBoundary(buffer);
      while (boundary !== undefined) {
        const record = parseSseRecord(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary.length);
        boundary = sseBoundary(buffer);
        if (record === undefined) continue;
        const message = decodeStreamSseEvent(record.event, record.data);
        if (message.kind === "setup") manifest = message.manifest;
        if (message.kind === "update") {
          return {
            snapshot: validateSnapshot(message.snapshot),
            ...omitUndefined({ manifest: manifest }),
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

/** Ignore comments and unknown events while joining data lines according to the SSE record format. */
function parseSseRecord(record: string): Readonly<ParseSseRecord> | undefined {
  let event: StreamSseEvent | undefined = undefined;
  const data: string[] = [];
  for (const line of record.split(/\r\n|\r|\n/gu)) {
    // Ignore comments and unknown events while joining data lines according to the SSE record format.

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

function sseBoundary(value: string): Readonly<SseBoundary> | undefined {
  const match = /(?:\r\n|\r|\n){2}/u.exec(value);
  return match?.index === undefined ? undefined : { index: match.index, length: match[0].length };
}

export const SnapshotEnvelopeWireSchema = z
  .object({ snapshot: CompiledSnapshotWireSchema, manifest: AssetManifestWireSchema.optional() })
  .transform(omitUndefined);
export type SnapshotEnvelopeWire = z.output<typeof SnapshotEnvelopeWireSchema>;

function readSnapshotEnvelope(
  value: Parameters<typeof SnapshotEnvelopeWireSchema.parse>[0],
): SnapshotEnvelope {
  const envelope = SnapshotEnvelopeWireSchema.safeParse(value);
  if (envelope.success) return envelope.data;
  return { snapshot: validateSnapshot(value) };
}

function validateSnapshot(
  value: Parameters<typeof CompiledSnapshotWireSchema.parse>[0],
): CompiledSnapshot {
  const parsed = CompiledSnapshotWireSchema.safeParse(value);
  if (!parsed.success)
    throw new TypeError(
      "Input is not a Vignette compiled snapshot with positive canvas dimensions.",
    );
  return parsed.data;
}

function manifestUrls(
  manifest: AssetManifest | undefined,
  baseUrl: string | undefined,
): Readonly<Record<string, string>> {
  if (manifest === undefined) return {};
  return Object.fromEntries(
    manifest.assets.map((entry) => [entry.name, resolveSnapshotUrl(entry.url, baseUrl)]),
  );
}

/** Built-in browser sources are the only snapshot fields the preview loads by URL. */
function requireResolvableUrls(
  snapshot: CompiledSnapshot,
  baseUrl: string | undefined,
): CompiledSnapshot {
  for (const { definition } of snapshot.sources) {
    if (definition.kind !== "source:browser") continue;
    const parsed: SourceUrl | undefined = SourceUrlSchema.safeParse(definition).data;
    const url = parsed?.url;
    if (url !== undefined) resolveSnapshotUrl(url, baseUrl);
  }
  return snapshot;
}

const SourceUrlSchema = z.object({ url: z.string() });
type SourceUrl = z.output<typeof SourceUrlSchema>;

function resolveSnapshotUrl(url: string, baseUrl: string | undefined): string {
  if (baseUrl === undefined && isRootRelativeUrl(url)) {
    throw new Error(
      `Snapshot contains root-relative URL '${url}'; pass --base-url <url> to resolve it.`,
    );
  }
  return resolveResourceUrl(url, baseUrl);
}

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function isRuntimeEvent(value: string): value is StreamSseEvent {
  return value === "setup" || value === "update" || value === "event";
}
