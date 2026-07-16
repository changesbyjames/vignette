import { OBSWebSocket } from "obs-websocket-js";

import type { ObsJsonObject } from "./operations.js";
import type {
  ObsBatchRequest,
  ObsBatchResponse,
  ObsConnectOptions,
  ObsConnectionInfo,
  ObsEventListener,
  ObsTransport,
} from "./transport.js";

interface ClientFacade {
  connect(
    url: string,
    password: string | undefined,
    identification: { readonly rpcVersion: number },
  ): Promise<unknown>;
  disconnect(): Promise<void>;
  call(requestType: string, requestData?: ObsJsonObject): Promise<unknown>;
  callBatch(requests: readonly ObsBatchRequest[]): Promise<readonly unknown[]>;
  on(event: string, listener: ObsEventListener): void;
  off(event: string, listener: ObsEventListener): void;
}

export class ObsWebSocketTransport implements ObsTransport {
  readonly #client: ClientFacade;

  constructor() {
    this.#client = new OBSWebSocket() as unknown as ClientFacade;
  }

  async connect(options: ObsConnectOptions): Promise<ObsConnectionInfo> {
    const result = await this.#client.connect(options.url, options.password, {
      rpcVersion: options.rpcVersion ?? 1,
    });
    const record = asRecord(result);
    return {
      obsWebSocketVersion: readString(record, "obsWebSocketVersion"),
      negotiatedRpcVersion: readNumber(record, "negotiatedRpcVersion"),
    };
  }

  disconnect(): Promise<void> {
    return this.#client.disconnect();
  }

  async call(requestType: string, requestData?: ObsJsonObject): Promise<ObsJsonObject> {
    const value = await this.#client.call(requestType, requestData);
    return toJsonObject(value);
  }

  async callBatch(requests: readonly ObsBatchRequest[]): Promise<readonly ObsBatchResponse[]> {
    const values = await this.#client.callBatch(requests);
    return values.map((value) => {
      const record = asRecord(value);
      const status = asRecord(record.requestStatus);
      const responseData = toJsonObject(record.responseData);
      return {
        requestType: readString(record, "requestType"),
        ok: readBoolean(status, "result"),
        code: readNumber(status, "code"),
        ...(typeof status.comment === "string" ? { comment: status.comment } : {}),
        ...(Object.keys(responseData).length === 0 ? {} : { responseData }),
      };
    });
  }

  on(event: string, listener: ObsEventListener): () => void {
    this.#client.on(event, listener);
    return () => {
      this.#client.off(event, listener);
    };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function toJsonObject(value: unknown): ObsJsonObject {
  return asRecord(value) as ObsJsonObject;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`OBS response is missing string '${key}'.`);
  return value;
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number") throw new Error(`OBS response is missing number '${key}'.`);
  return value;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") throw new Error(`OBS response is missing boolean '${key}'.`);
  return value;
}
