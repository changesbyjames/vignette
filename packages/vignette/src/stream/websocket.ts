import { z } from "zod";

import { createAsyncQueue } from "./async-queue.js";
import { StreamMessageSchema, type StreamMessage } from "./messages.js";
import { reconnecting, type StreamConnectOptions } from "./reconnect.js";

/**
 * The transport-neutral wire format: one stream message as JSON text. WebSocket hosts send
 * `encodeStreamMessage(message)` per message of `composer.stream()`, and so can any transport
 * that frames messages itself (IPC, queues); `decodeStreamMessage` validates against the message
 * schemas. SSE frames the same JSON as named events (`toSseEvent`).
 */
export function encodeStreamMessage(message: StreamMessage): string {
  return JSON.stringify(message);
}

/** Validates and decodes one JSON-encoded stream message. */
export function decodeStreamMessage(data: string): StreamMessage {
  return StreamMessageSchema.parse(JSON.parse(data));
}

/** What a socket delivers with `binaryType = "arraybuffer"`: text, or bytes of UTF-8 JSON. */
const WebSocketDataSchema = z.union([z.string(), z.instanceof(ArrayBuffer)]);
type WebSocketData = z.output<typeof WebSocketDataSchema>;

/**
 * Reads a stream from a `ws:` or `wss:` URL with the platform `WebSocket` (browsers, Node 22+,
 * Deno, Bun, Workers), reconnecting exactly as `fromSse` does: capped exponential backoff after a
 * connection fails or closes, until `signal` aborts or iteration stops, with `onConnection`
 * reporting `connecting`, `open`, `retry-wait` and `closed`. The server replays setup and the
 * latest update on every connection. A message that is not a valid stream message ends iteration
 * with its schema error.
 */
export function fromWebSocket(
  url: string | URL,
  options: StreamConnectOptions = {},
): AsyncIterable<StreamMessage> {
  return reconnecting(url, connection, options);
}

/**
 * One socket: calls `opened` when it opens, yields its messages, returns when the server closes
 * normally and throws when it fails or closes otherwise. Closes when iteration stops or `signal`
 * aborts.
 */
async function* connection(
  url: string | URL,
  signal: AbortSignal,
  opened: () => void,
): AsyncGenerator<StreamMessage> {
  const queue = createAsyncQueue<string>();
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  const decoder = new TextDecoder();
  const close = () => {
    socket.close();
  };
  signal.addEventListener("abort", close, { once: true });
  socket.addEventListener("open", opened);
  socket.addEventListener("message", (event: MessageEvent<unknown>) => {
    const data: z.ZodSafeParseResult<WebSocketData> = WebSocketDataSchema.safeParse(event.data);
    if (!data.success) {
      queue.fail(new Error("WebSocket message is neither text nor an ArrayBuffer."));
      return;
    }
    queue.push(data.data instanceof ArrayBuffer ? decoder.decode(data.data) : data.data);
  });
  socket.addEventListener("error", () => {
    queue.fail(new Error(`WebSocket connection to ${String(url)} failed.`));
  });
  socket.addEventListener("close", (event) => {
    if (event.code === 1000) queue.close();
    else {
      const reason = event.reason === "" ? "" : `: ${event.reason}`;
      queue.fail(new Error(`WebSocket closed with code ${String(event.code)}${reason}.`));
    }
  });
  try {
    for await (const data of queue) yield decodeStreamMessage(data);
  } finally {
    signal.removeEventListener("abort", close);
    close();
  }
}
