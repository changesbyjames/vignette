import {
  createAsyncQueue,
  decodeStreamSseEvent,
  STREAM_SSE_EVENTS,
  type StreamMessage,
  type StreamSource,
} from "@strangecyan/vignette-core";

/**
 * A composer stream source backed by an `EventSource` reading the wire format produced by
 * `encodeStreamMessageSse`. The source exposes `url`, which `useStage` uses as the default
 * base for root-relative snapshot URLs.
 */
export function sseStream(url: string): StreamSource {
  return Object.assign((signal: AbortSignal) => consume(url, signal), { url });
}

async function* consume(url: string, signal: AbortSignal): AsyncIterable<StreamMessage> {
  if (signal.aborted) return;
  const source = new EventSource(url);
  const queue = createAsyncQueue<StreamMessage>();
  const listeners = STREAM_SSE_EVENTS.map((event) => {
    const listener = ({ data }: MessageEvent<string>) => {
      try {
        queue.push(decodeStreamSseEvent(event, data));
      } catch (cause) {
        queue.fail(
          cause instanceof Error ? cause : new Error("Stream SSE message failed.", { cause }),
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
