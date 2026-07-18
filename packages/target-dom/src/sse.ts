import {
  createAsyncQueue,
  decodeRuntimeSseEvent,
  RUNTIME_SSE_EVENTS,
  type RuntimeMessage,
  type RuntimeMessageSource,
} from "@strangecyan/vignette-core";

/**
 * A runtime message transport backed by an `EventSource` reading the wire format produced by
 * `encodeRuntimeMessageSse`.
 */
export function sseRuntimeSource(url: string): RuntimeMessageSource {
  return (signal) => consume(url, signal);
}

async function* consume(url: string, signal: AbortSignal): AsyncIterable<RuntimeMessage> {
  if (signal.aborted) return;
  const source = new EventSource(url);
  const queue = createAsyncQueue<RuntimeMessage>();
  const listeners = RUNTIME_SSE_EVENTS.map((event) => {
    const listener = ({ data }: MessageEvent<string>) => {
      try {
        queue.push(decodeRuntimeSseEvent(event, data));
      } catch (cause) {
        queue.fail(
          cause instanceof Error ? cause : new Error("Runtime SSE message failed.", { cause }),
        );
      }
    };
    source.addEventListener(event, listener);
    return [event, listener] as const;
  });
  const abort = () => {
    queue.close();
  };
  signal.addEventListener("abort", abort, { once: true });

  try {
    yield* queue;
  } finally {
    signal.removeEventListener("abort", abort);
    for (const [event, listener] of listeners) source.removeEventListener(event, listener);
    source.close();
  }
}
