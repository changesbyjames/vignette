import type { ObsJsonObject } from "./operations.js";

export interface ObsConnectOptions {
  readonly url: string;
  readonly password?: string;
  readonly rpcVersion?: number;
}

export interface ObsConnectionInfo {
  readonly obsWebSocketVersion: string;
  readonly negotiatedRpcVersion: number;
}

export interface ObsBatchRequest {
  readonly requestType: string;
  readonly requestData?: ObsJsonObject;
}

export interface ObsBatchResponse {
  readonly requestType: string;
  readonly ok: boolean;
  readonly code: number;
  readonly comment?: string;
  readonly responseData?: ObsJsonObject;
}

export type ObsEventListener = (payload: unknown) => void;

/** Narrow seam used by bootstrap and execution. It is deliberately client-agnostic. */
export interface ObsTransport {
  connect(options: ObsConnectOptions): Promise<ObsConnectionInfo>;
  disconnect(): Promise<void>;
  call(requestType: string, requestData?: ObsJsonObject): Promise<ObsJsonObject>;
  callBatch(requests: readonly ObsBatchRequest[]): Promise<readonly ObsBatchResponse[]>;
  on(event: string, listener: ObsEventListener): () => void;
}
