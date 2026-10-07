import { readObsErrorCode } from "@strangecyan/vignette-target-obs";
import { omitUndefined } from "@strangecyan/vignette-core";
import type {
  ObsBatchRequest,
  ObsBatchResponse,
  ObsConnectOptions,
  ObsConnectionInfo,
  ObsEventListener,
  ObsJsonObject,
  ObsTransport,
} from "@strangecyan/vignette-target-obs";

/** OBS request captured by `FakeObsTransport`. */
export interface FakeObsRequest {
  readonly requestType: string;
  readonly requestData?: ObsJsonObject;
}

/** Queued fake response value, error, promise, or request-data handler. */
export type FakeResponse =
  | ObsJsonObject
  | Error
  | Promise<ObsJsonObject>
  | ((data: ObsJsonObject | undefined) => ObsJsonObject | Promise<ObsJsonObject>);

/** Connection options captured by the fake transport. */
export interface FakeObsConnectionAttempt {
  readonly url: string;
  readonly rpcVersion?: number;
}

/** Deterministic programmable OBS transport for unit tests. */
export class FakeObsTransport implements ObsTransport {
  readonly requests: FakeObsRequest[] = [];
  readonly connections: FakeObsConnectionAttempt[] = [];
  private readonly responses = new Map<string, FakeResponse[]>();
  private readonly listeners = new Map<string, Set<ObsEventListener>>();
  connected = false;
  connectError: Error | undefined;
  disconnectAtRequest: number | undefined;

  enqueue(requestType: string, ...responses: readonly FakeResponse[]): this {
    const queue = this.responses.get(requestType) ?? [];
    queue.push(...responses);
    this.responses.set(requestType, queue);
    return this;
  }

  connect(options: ObsConnectOptions): Promise<ObsConnectionInfo> {
    if (this.connectError !== undefined) return Promise.reject(this.connectError);
    this.connections.push({
      url: options.url,
      ...omitUndefined({ rpcVersion: options.rpcVersion }),
    });
    this.connected = true;
    return Promise.resolve({ obsWebSocketVersion: "5.fake", negotiatedRpcVersion: 1 });
  }

  disconnect(): Promise<void> {
    this.connected = false;
    return Promise.resolve();
  }

  /** Record connected requests, apply queued failures, and resolve the configured response or fallback. */
  async call(requestType: string, requestData?: ObsJsonObject): Promise<ObsJsonObject> {
    if (!this.connected) throw new Error("Fake OBS transport is disconnected.");
    this.requests.push({ requestType, ...omitUndefined({ requestData: requestData }) });
    if (this.disconnectAtRequest === this.requests.length) {
      this.connected = false;
      throw new Error("Fake OBS transport disconnected before the response.");
    }
    const response = this.responses.get(requestType)?.shift();
    if (response === undefined) return {};
    if (response instanceof Error) throw response;
    try {
      return await (response instanceof Function ? response(requestData) : response);
    } catch (cause) {
      throw cause instanceof Error ? cause : new Error("Fake response failed.");
    }
  }

  /** Run requests in order and turn each failure into a protocol-style batch result. */
  async callBatch(requests: readonly ObsBatchRequest[]): Promise<readonly ObsBatchResponse[]> {
    const responses: ObsBatchResponse[] = [];
    for (const request of requests) {
      try {
        const responseData = await this.call(request.requestType, request.requestData);
        responses.push({
          requestType: request.requestType,
          ok: true,
          code: 100,
          responseData,
        });
      } catch (cause) {
        responses.push({
          requestType: request.requestType,
          ok: false,
          code: readObsErrorCode(cause) ?? 500,
          comment: cause instanceof Error ? cause.message : "Fake failure",
        });
      }
    }
    return responses;
  }

  on(event: string, listener: ObsEventListener): () => void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return () => listeners.delete(listener);
  }

  /** Connection closure updates transport state before notifying all listeners for that event. */
  emit(event: string, payload: Parameters<ObsEventListener>[0] = {}): void {
    if (event === "ConnectionClosed") this.connected = false;
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}
