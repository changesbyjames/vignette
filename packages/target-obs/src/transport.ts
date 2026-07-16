import type { ObsJsonObject } from "./operations.js";

/** Connection credentials and requested obs-websocket RPC version. */
export interface ObsConnectOptions {
  readonly url: string;
  readonly password?: string;
  readonly rpcVersion?: number;
}

/** Versions negotiated after connecting to obs-websocket. */
export interface ObsConnectionInfo {
  readonly obsWebSocketVersion: string;
  readonly negotiatedRpcVersion: number;
}

/** One request in an obs-websocket batch. */
export interface ObsBatchRequest {
  readonly requestType: string;
  readonly requestData?: ObsJsonObject;
}

/** One ordered response from an obs-websocket batch. */
export interface ObsBatchResponse {
  readonly requestType: string;
  readonly ok: boolean;
  readonly code: number;
  readonly comment?: string;
  readonly responseData?: ObsJsonObject;
}

/** Listener for an obs-websocket event payload. */
export type ObsEventListener = (payload: unknown) => void;

/** Narrow seam used by bootstrap and execution. It is deliberately client-agnostic. */
export interface ObsTransport {
  connect(options: ObsConnectOptions): Promise<ObsConnectionInfo>;
  disconnect(): Promise<void>;
  call(requestType: string, requestData?: ObsJsonObject): Promise<ObsJsonObject>;
  callBatch(requests: readonly ObsBatchRequest[]): Promise<readonly ObsBatchResponse[]>;
  on(event: string, listener: ObsEventListener): () => void;
}
