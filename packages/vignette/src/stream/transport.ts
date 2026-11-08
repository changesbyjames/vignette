import type { StreamMessage } from "./messages.js";
import type { StreamConnectOptions } from "./reconnect.js";
import { fromSse } from "./sse.js";
import { fromWebSocket } from "./websocket.js";

/**
 * How a client reads a stream from a URL, for the URL schemes in `protocols`. A frame page picks
 * one by the scheme of the stream URL it is given, which is the setup's `serve.stream` with
 * `?source=<id>` added, so the scheme the host publishes there chooses the transport.
 *
 * `connect` follows the URL until `options.signal` aborts or iteration stops. It owns
 * reconnection: every new connection must start with setup and the latest update, as the hub
 * replays them, and it should report its state through `options.onConnection`. `reconnecting`
 * from this module gives a transport that loop for one `open(url, signal, opened)` function.
 */
export interface StreamTransport {
  /** URL schemes with their trailing colon, as `URL.protocol` spells them, e.g. `"wss:"`. */
  readonly protocols: readonly string[];
  readonly connect: (url: string, options: StreamConnectOptions) => AsyncIterable<StreamMessage>;
}

/** Server-sent events over `fetch`, for `http:` and `https:` stream URLs. */
export const sseTransport: StreamTransport = {
  protocols: ["http:", "https:"],
  connect: (url, options) => fromSse(url, options),
};

/** The platform `WebSocket`, for `ws:` and `wss:` stream URLs. */
export const webSocketTransport: StreamTransport = {
  protocols: ["ws:", "wss:"],
  connect: (url, options) => fromWebSocket(url, options),
};

/** The transports every client knows: SSE and WebSocket. */
export const DEFAULT_STREAM_TRANSPORTS: readonly StreamTransport[] = [
  sseTransport,
  webSocketTransport,
];

/** Options of {@link connectStream}. */
export interface ConnectStreamOptions extends StreamConnectOptions {
  /**
   * Transports added to the defaults; a later one wins for a scheme, including over SSE and
   * WebSocket.
   */
  readonly transports?: readonly StreamTransport[];
}

/**
 * Follows the stream at `url` with the transport for its scheme: SSE for `http(s):`, WebSocket
 * for `ws(s):`, or one of `options.transports`. A relative URL resolves against the page's
 * location where there is one. When no transport handles the scheme, iteration fails with
 * `UNSUPPORTED_TRANSPORT`, so a target reports it as its error instead of throwing here.
 */
export function connectStream(
  url: string,
  options: ConnectStreamOptions = {},
): AsyncIterable<StreamMessage> {
  const { transports = [], ...connect } = options;
  const protocol = new URL(url, globalThis.location?.href ?? "http://localhost").protocol;
  const transport = [...DEFAULT_STREAM_TRANSPORTS, ...transports].findLast((candidate) =>
    candidate.protocols.includes(protocol),
  );
  if (transport !== undefined) return transport.connect(url, connect);
  const error = new Error(
    `UNSUPPORTED_TRANSPORT: no stream transport handles "${protocol}" (${url}).`,
  );
  return {
    [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(error) }),
  };
}
