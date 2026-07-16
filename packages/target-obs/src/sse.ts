import {
  decodeRuntimeSseEvent,
  RUNTIME_SSE_EVENTS,
  type RuntimeMessage,
  type RuntimeMessageSource,
  type RuntimeSseEvent,
} from "@cbj/react-obs-core";

export interface SseRuntimeSourceOptions {
  readonly retryDelayMs?: number;
  readonly onError?: (error: Error) => void;
}

/**
 * A Node runtime message transport backed by `fetch`, matching target-dom's
 * `sseRuntimeSource(url)` API. Connections retry after failures; the server's replay converges a
 * reconnected runtime to the latest setup and snapshot.
 */
export function sseRuntimeSource(
  url: string,
  options: SseRuntimeSourceOptions = {},
): RuntimeMessageSource {
  return (signal) => consume(url, options, signal);
}

async function* consume(
  url: string,
  options: SseRuntimeSourceOptions,
  signal: AbortSignal,
): AsyncIterable<RuntimeMessage> {
  while (!signal.aborted) {
    try {
      yield* consumeConnection(url, signal);
      if (!isAborted(signal)) throw new Error("Runtime SSE connection ended unexpectedly.");
    } catch (cause) {
      if (isAborted(signal)) return;
      options.onError?.(normalizeError(cause));
    }
    await wait(options.retryDelayMs ?? 1_000, signal);
  }
}

async function* consumeConnection(url: string, signal: AbortSignal): AsyncIterable<RuntimeMessage> {
  const response = await fetch(url, {
    headers: { Accept: "text/event-stream" },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Runtime SSE request failed with HTTP ${String(response.status)}.`);
  }
  if (response.body === null) throw new Error("Runtime SSE response did not have a body.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) return;
      buffer += decoder.decode(chunk.value as Uint8Array, { stream: true });

      let boundary = findEventBoundary(buffer);
      while (boundary !== undefined) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const message = decodeEventBlock(block);
        if (message !== undefined) yield message;
        boundary = findEventBoundary(buffer);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function findEventBoundary(
  value: string,
): { readonly index: number; readonly length: number } | undefined {
  const match = /\r?\n\r?\n/u.exec(value);
  return match === null ? undefined : { index: match.index, length: match[0].length };
}

function decodeEventBlock(block: string): RuntimeMessage | undefined {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of block.split(/\r?\n/u)) {
    if (line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    const raw = separator < 0 ? "" : line.slice(separator + 1);
    const value = raw.startsWith(" ") ? raw.slice(1) : raw;
    if (field === "event") event = value;
    if (field === "data") data.push(value);
  }
  if (event === undefined || !isRuntimeEvent(event)) return undefined;
  return decodeRuntimeSseEvent(event, data.join("\n"));
}

function isRuntimeEvent(value: string): value is RuntimeSseEvent {
  return (RUNTIME_SSE_EVENTS as readonly string[]).includes(value);
}

function normalizeError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error("Runtime SSE connection failed.", { cause });
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
