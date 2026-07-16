import type {
  ObsBatchRequest,
  ObsBatchResponse,
  ObsConnectOptions,
  ObsConnectionInfo,
  ObsEventListener,
  ObsJsonObject,
  ObsTransport,
} from "@cbj/react-obs-target-obs";

export interface FakeObsRequest {
  readonly requestType: string;
  readonly requestData?: ObsJsonObject;
}

export type FakeResponse =
  | ObsJsonObject
  | Error
  | Promise<ObsJsonObject>
  | ((data: ObsJsonObject | undefined) => ObsJsonObject | Promise<ObsJsonObject>);

export interface FakeObsConnectionAttempt {
  readonly url: string;
  readonly rpcVersion?: number;
}

export class FakeObsTransport implements ObsTransport {
  readonly requests: FakeObsRequest[] = [];
  readonly connections: FakeObsConnectionAttempt[] = [];
  readonly #responses = new Map<string, FakeResponse[]>();
  readonly #listeners = new Map<string, Set<ObsEventListener>>();
  connected = false;
  connectError: Error | undefined;
  disconnectAtRequest: number | undefined;

  enqueue(requestType: string, ...responses: readonly FakeResponse[]): this {
    const queue = this.#responses.get(requestType) ?? [];
    queue.push(...responses);
    this.#responses.set(requestType, queue);
    return this;
  }

  connect(options: ObsConnectOptions): Promise<ObsConnectionInfo> {
    if (this.connectError !== undefined) return Promise.reject(this.connectError);
    this.connections.push({
      url: options.url,
      ...(options.rpcVersion === undefined ? {} : { rpcVersion: options.rpcVersion }),
    });
    this.connected = true;
    return Promise.resolve({ obsWebSocketVersion: "5.fake", negotiatedRpcVersion: 1 });
  }

  disconnect(): Promise<void> {
    this.connected = false;
    return Promise.resolve();
  }

  async call(requestType: string, requestData?: ObsJsonObject): Promise<ObsJsonObject> {
    if (!this.connected) throw new Error("Fake OBS transport is disconnected.");
    this.requests.push({ requestType, ...(requestData === undefined ? {} : { requestData }) });
    if (this.disconnectAtRequest === this.requests.length) {
      this.connected = false;
      throw new Error("Fake OBS transport disconnected before the response.");
    }
    const response = this.#responses.get(requestType)?.shift();
    if (response === undefined) return {};
    if (response instanceof Error) throw response;
    try {
      return await (typeof response === "function" ? response(requestData) : response);
    } catch (cause) {
      throw cause instanceof Error ? cause : new Error("Fake response failed.");
    }
  }

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
          code: readErrorCode(cause) ?? 500,
          comment: cause instanceof Error ? cause.message : "Fake failure",
        });
      }
    }
    return responses;
  }

  on(event: string, listener: ObsEventListener): () => void {
    const listeners = this.#listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(event, listeners);
    return () => listeners.delete(listener);
  }

  emit(event: string, payload: unknown = {}): void {
    if (event === "ConnectionClosed") this.connected = false;
    for (const listener of this.#listeners.get(event) ?? []) listener(payload);
  }

  listenerCount(event: string): number {
    return this.#listeners.get(event)?.size ?? 0;
  }
}

function readErrorCode(cause: unknown): number | undefined {
  if (typeof cause !== "object" || cause === null) return undefined;
  const code = (cause as { readonly code?: unknown }).code;
  return typeof code === "number" ? code : undefined;
}
