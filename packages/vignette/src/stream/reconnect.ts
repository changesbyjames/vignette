import { z } from "zod";

import type { StreamMessage } from "./messages.js";

/** Reconnection delays for a URL stream: doubling from `initialDelayMs` up to `maximumDelayMs`. */
export interface RetryOptions {
  /** Delay before the first reconnect; default 500 ms. */
  readonly initialDelayMs?: number;
  /** Upper bound of the doubling delay; default 10 s. */
  readonly maximumDelayMs?: number;
}

/** Where a connection is (plan §6.5). */
export type ConnectionPhase = "connecting" | "open" | "retry-wait" | "closed";

/** What `onConnection` reports for a URL stream, whatever its transport. */
export interface StreamConnection {
  readonly phase: ConnectionPhase;
  /** Consecutive connections that failed, or ended sooner than the backoff they now wait. */
  readonly attempt: number;
  /** The last failure, until a connection delivers a message. */
  readonly error?: Error;
}

/** Options of a reconnecting URL stream: `fromSse`, `fromWebSocket` or a custom transport. */
export interface StreamConnectOptions {
  /** Ends the stream and closes the connection. */
  readonly signal?: AbortSignal;
  readonly retry?: RetryOptions;
  /** Called with the connection state whenever it changes. */
  readonly onConnection?: (state: StreamConnection) => void;
}

/**
 * One connection of a transport: calls `opened` once it is established, yields its messages,
 * returns when the peer ends it and throws when it fails. It must close when `signal` aborts.
 */
export type OpenConnection = (
  url: string | URL,
  signal: AbortSignal,
  opened: () => void,
) => AsyncIterable<StreamMessage>;

/**
 * Follows `url` through `open` until `signal` aborts or iteration stops, reconnecting with capped
 * exponential backoff whenever a connection fails or ends. A message that is not valid JSON or
 * fails its schema ends the stream with that error, because retrying would receive it again.
 * This is the loop behind `fromSse` and `fromWebSocket`; custom transports can reuse it.
 */
export function reconnecting(
  url: string | URL,
  open: OpenConnection,
  options: StreamConnectOptions = {},
): AsyncIterable<StreamMessage> {
  const signal = options.signal ?? new AbortController().signal;
  return {
    [Symbol.asyncIterator]: () => {
      // Its own abort, so stopping iteration (`break`, `return()`) closes the connection or cuts
      // the backoff short instead of waiting for them.
      const stop = new AbortController();
      const generator = reconnect(url, open, options, AbortSignal.any([signal, stop.signal]));
      return {
        next: () => generator.next(),
        return: () => {
          stop.abort();
          return generator.return(undefined);
        },
      };
    },
  };
}

/**
 * Connects to `url` until `signal` aborts (plan §6.5): `connecting` until the connection opens,
 * `open` while it is read, `retry-wait` for the backoff after it ends or fails, `closed` when the
 * signal aborts or a malformed message ends the stream. The backoff resets only after a
 * connection stays open at least as long as the delay it would otherwise wait: every connection
 * replays setup, so a server that accepts and ends at once (one shutting down, a proxy cutting
 * streams) is retried with growing delays instead of in a tight loop.
 */
async function* reconnect(
  url: string | URL,
  open: OpenConnection,
  options: StreamConnectOptions,
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
    // Connect, read until the connection ends or fails, back off, repeat; abort ends it anywhere.
    while (!signal.aborted) {
      // One connection: its messages reset the backoff; its failure is kept for the report.
      report("connecting");
      try {
        for await (const message of open(url, signal, opened)) {
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

/** A message that is not a valid stream message. */
function isMalformed(cause: unknown): boolean {
  return cause instanceof SyntaxError || cause instanceof z.ZodError;
}

/** The delay before reconnect `attempt` (from 1): doubling, capped; 500 ms up to 10 s by default. */
function backoff(attempt: number, retry: RetryOptions = {}): number {
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
