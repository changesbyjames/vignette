import { z } from "zod";

import type { StreamMessage } from "./messages.js";
import { decodeStreamSseEvent, STREAM_SSE_EVENTS, type StreamSseEvent } from "./sse-codec.js";

/** Reconnection delays for a URL stream: doubling from `initialDelayMs` up to `maximumDelayMs`. */
export interface SseRetryOptions {
  /** Delay before the first reconnect; default 500 ms. */
  readonly initialDelayMs?: number;
  /** Upper bound of the doubling delay; default 10 s. */
  readonly maximumDelayMs?: number;
}

/** Where a connection is (plan §6.5). */
export type ConnectionPhase = "connecting" | "open" | "retry-wait" | "closed";

/** What `onConnection` reports for a URL stream. */
export interface SseConnection {
  readonly phase: ConnectionPhase;
  /** Consecutive connections that failed, or ended sooner than the backoff they now wait. */
  readonly attempt: number;
  /** The last failure, until a connection delivers a message. */
  readonly error?: Error;
}

/** Options of {@link fromSse}. */
export interface FromSseOptions {
  /** Ends the stream and closes the connection. */
  readonly signal?: AbortSignal;
  readonly retry?: SseRetryOptions;
  /** Called with the connection state of a URL stream whenever it changes. */
  readonly onConnection?: (state: SseConnection) => void;
}

/** Anything `fromSse` can read: a URL to connect to, or a response or body to read once. */
export type SseInput = string | URL | Response | ReadableStream<Uint8Array>;

/**
 * Reads a stream from server-sent events. Given a URL, it connects with `fetch` and reconnects
 * with capped exponential backoff whenever the connection fails or ends, until `signal` aborts or
 * iteration stops; the server's replay of setup and the latest update converges a reconnected
 * target. `onConnection` reports `connecting`, `open`, `retry-wait` and `closed`. Given a
 * `Response` or a body stream, it reads it once and ends with it. A record that is not a valid
 * stream message ends iteration with its schema error.
 */
export function fromSse(
  input: SseInput,
  options: FromSseOptions = {},
): AsyncIterable<StreamMessage> {
  const signal = options.signal ?? new AbortController().signal;
  if (input instanceof Response)
    return { [Symbol.asyncIterator]: () => readResponse(input, signal) };
  if (input instanceof ReadableStream) {
    return { [Symbol.asyncIterator]: () => readBody(input, signal) };
  }
  return { [Symbol.asyncIterator]: () => reconnecting(input, options, signal) };
}

/**
 * Connects to `url` until `signal` aborts (plan §6.5): `connecting` until the response is OK,
 * `open` while its body is read, `retry-wait` for the backoff after it ends or fails, `closed`
 * when the signal aborts or a malformed message ends the stream. The backoff resets only after a
 * connection stays open at least as long as the delay it would otherwise wait: every connection
 * replays setup, so a server that accepts and ends at once (one shutting down, a proxy cutting
 * streams) is retried with growing delays instead of in a tight loop.
 */
async function* reconnect(
  url: string | URL,
  options: FromSseOptions,
  signal: AbortSignal,
): AsyncGenerator<StreamMessage> {
  let attempt = 0;
  let error: Error | undefined = undefined;
  const report = (phase: ConnectionPhase) => {
    options.onConnection?.({ phase, attempt, error });
  };
  let openedAt: number | undefined = undefined;
  const opened = () => {
    openedAt = Date.now();
    report("open");
  };
  // A delivered message clears the last failure; only staying open resets the backoff.
  const delivered = () => {
    if (error === undefined) return;
    error = undefined;
    report("open");
  };
  try {
    // Connect, read until the body ends or fails, back off, repeat; abort ends it in any phase.
    while (!signal.aborted) {
      // One connection: its messages reset the backoff; its failure is kept for the report.
      report("connecting");
      try {
        for await (const message of connection(url, signal, opened)) {
          delivered();
          yield message;
        }
      } catch (cause) {
        if (signal.aborted) return;
        error = cause instanceof Error ? cause : new Error(String(cause));
        // Retrying would receive the same malformed message again.
        if (isMalformed(cause)) throw cause;
      }
      if (signal.aborted) return;
      if (openedAt !== undefined && Date.now() - openedAt >= backoff(attempt + 1, options.retry)) {
        attempt = 0;
      }
      openedAt = undefined;
      attempt += 1;
      report("retry-wait");
      await sleep(backoff(attempt, options.retry), signal);
    }
  } finally {
    report("closed");
  }
}

/** A record that is not a valid stream message. */
function isMalformed(cause: unknown): boolean {
  return cause instanceof SyntaxError || cause instanceof z.ZodError;
}

/** One request: calls `opened` once the response is OK, then yields its messages. */
async function* connection(
  url: string | URL,
  signal: AbortSignal,
  opened: () => void,
): AsyncGenerator<StreamMessage> {
  const response = await fetch(url, { headers: { accept: "text/event-stream" }, signal });
  const body = bodyOf(response);
  opened();
  yield* readBody(body, signal);
}

/** The delay before reconnect `attempt` (from 1): doubling, capped; 500 ms up to 10 s by default. */
function backoff(attempt: number, retry: SseRetryOptions = {}): number {
  const { initialDelayMs = 500, maximumDelayMs = 10_000 } = retry;
  return Math.min(initialDelayMs * 2 ** (attempt - 1), maximumDelayMs);
}

/** Resolves after `ms`, or as soon as `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * Iterates `reconnect` with its own abort, so stopping iteration (`break`, `return()`) closes the
 * connection or cuts the backoff short instead of waiting for them.
 */
function reconnecting(
  url: string | URL,
  options: FromSseOptions,
  signal: AbortSignal,
): AsyncIterator<StreamMessage> {
  const stop = new AbortController();
  const generator = reconnect(url, options, AbortSignal.any([signal, stop.signal]));
  return {
    next: () => generator.next(),
    return: () => {
      stop.abort();
      return generator.return(undefined);
    },
  };
}

/** The body of an OK response. */
function bodyOf(response: Response): ReadableStream<Uint8Array> {
  if (!response.ok) {
    throw new Error(`Stream request failed with HTTP ${String(response.status)}.`);
  }
  if (response.body === null) throw new Error("Stream response has no body.");
  return response.body;
}

async function* readResponse(
  response: Response,
  signal: AbortSignal,
): AsyncGenerator<StreamMessage> {
  yield* readBody(bodyOf(response), signal);
}

/** Decodes the body chunk by chunk; cancels it when iteration stops or the signal aborts. */
async function* readBody(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<StreamMessage> {
  const reader = body.getReader();
  const cancel = () => {
    reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder();
  const parser = createSseParser();
  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) return;
      yield* parser.push(decoder.decode(chunk.value, { stream: true }));
    }
  } catch (cause) {
    if (!signal.aborted) throw cause;
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
  }
}

/** Incremental SSE parser: text in, complete stream messages out. */
interface SseParser {
  push(text: string): StreamMessage[];
}

/** Fields of the record being assembled. */
interface SseRecord {
  event?: string;
  data: string[];
}

/**
 * The one SSE boundary scanner. Lines end in `\r\n`, `\n` or `\r`; a trailing `\r` waits for the
 * next chunk in case it is half of `\r\n`. A blank line dispatches the record; `:` lines are
 * comments; multiple `data:` lines join with `\n`. Events other than setup, update and event are
 * ignored, and a record cut off by the end of the body is discarded, as the SSE spec requires.
 */
function createSseParser(): SseParser {
  let buffer = "";
  let record: SseRecord = { data: [] };
  return {
    /** Splits complete lines off the buffer and feeds them to the record; keeps the remainder. */
    push(text) {
      buffer += text;
      const messages: StreamMessage[] = [];
      let start = 0;
      for (let index = 0; index < buffer.length; index += 1) {
        // Find each line terminator; a `\r` at the very end may be half of a `\r\n`.
        const char = buffer[index];
        if (char !== "\n" && char !== "\r") continue;
        if (char === "\r" && index === buffer.length - 1) break;
        const line = buffer.slice(start, index);
        if (char === "\r" && buffer[index + 1] === "\n") index += 1;
        start = index + 1;
        if (line === "") {
          const message = dispatchRecord(record);
          if (message !== undefined) messages.push(message);
          record = { data: [] };
        } else {
          readField(record, line);
        }
      }
      buffer = buffer.slice(start);
      return messages;
    },
  };
}

/** Applies one `field: value` line; a leading space after the colon is not part of the value. */
function readField(record: SseRecord, line: string): void {
  if (line.startsWith(":")) return;
  const colon = line.indexOf(":");
  const field = colon < 0 ? line : line.slice(0, colon);
  const raw = colon < 0 ? "" : line.slice(colon + 1);
  const value = raw.startsWith(" ") ? raw.slice(1) : raw;
  if (field === "event") record.event = value;
  if (field === "data") record.data.push(value);
}

function dispatchRecord(record: SseRecord): StreamMessage | undefined {
  const event = STREAM_SSE_EVENTS.find((name: StreamSseEvent) => name === record.event);
  if (event === undefined || record.data.length === 0) return undefined;
  return decodeStreamSseEvent(event, record.data.join("\n"));
}
