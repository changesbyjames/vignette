import {
  decodeStreamSseEvent,
  STREAM_SSE_EVENTS,
  type StreamMessage,
  type StreamSource,
  type StreamSseEvent,
} from "@strangecyan/vignette-core";

interface FindEventBoundary {
  readonly index: number;
  readonly length: number;
}

/** Reconnection behavior and error observation for an SSE runtime source. */
export interface SseStreamOptions {
  readonly retryDelayMs?: number | undefined;
  readonly onError?: ((error: Error) => void) | undefined;
}

/**
 * A Node composer stream source backed by `fetch`, matching target-dom's
 * `sseStream(url)` API. Connections retry after failures; the server's replay converges a
 * reconnected runtime to the latest setup and snapshot.
 */
export function sseStream(url: string, options: SseStreamOptions = {}): StreamSource {
  return Object.assign((signal: AbortSignal) => consume(url, options, signal), { url });
}

/** Reconnect after stream failure unless the caller aborted, reporting errors before waiting for the retry delay. */
async function* consume(
  url: string,
  options: SseStreamOptions,
  signal: AbortSignal,
): AsyncIterable<StreamMessage> {
  while (!signal.aborted) {
    // Reconnect after stream failure unless the caller aborted, reporting errors before waiting for the retry delay.

    try {
      yield* consumeConnection(url, signal);
      if (!isAborted(signal)) throw new Error("Stream SSE connection ended unexpectedly.");
    } catch (cause) {
      if (isAborted(signal)) return;
      options.onError?.(normalizeError(cause));
    }
    await wait(options.retryDelayMs ?? 1_000, signal);
  }
}

/** Decode complete SSE records from streamed UTF-8 chunks and cancel the reader when consumption ends. */
async function* consumeConnection(url: string, signal: AbortSignal): AsyncIterable<StreamMessage> {
  const response = await fetch(url, {
    headers: { Accept: "text/event-stream" },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Stream SSE request failed with HTTP ${String(response.status)}.`);
  }
  if (response.body === null) throw new Error("Stream SSE response did not have a body.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    // Decode complete SSE records from streamed UTF-8 chunks and cancel the reader when consumption ends.

    while (!signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) return;
      buffer += decoder.decode(
        /* SAFETY: A successful non-final read of the fetch body contains a Uint8Array chunk. */ chunk.value as Uint8Array,
        { stream: true },
      );

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

function findEventBoundary(value: string): FindEventBoundary | undefined {
  const match = /\r?\n\r?\n/u.exec(value);
  return match === null ? undefined : { index: match.index, length: match[0].length };
}

/** Ignore SSE comments, collect data lines, and decode only known stream message events. */
function decodeEventBlock(block: string): StreamMessage | undefined {
  let event: string | undefined = undefined;
  const data: string[] = [];
  for (const line of block.split(/\r?\n/u)) {
    // Ignore SSE comments, collect data lines, and decode only known stream message events.

    if (line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    const raw = separator < 0 ? "" : line.slice(separator + 1);
    const value = raw.startsWith(" ") ? raw.slice(1) : raw;
    if (field === "event") event = value;
    if (field === "data") data.push(value);
  }
  if (event === undefined || !isRuntimeEvent(event)) return undefined;
  return decodeStreamSseEvent(event, data.join("\n"));
}

function isRuntimeEvent(value: string): value is StreamSseEvent {
  return /* SAFETY: The event list contains only strings; widening its lookup input does not alter the closed event vocabulary. */ (
    STREAM_SSE_EVENTS as readonly string[]
  ).includes(value);
}

function normalizeError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error("Stream SSE connection failed.", { cause });
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
