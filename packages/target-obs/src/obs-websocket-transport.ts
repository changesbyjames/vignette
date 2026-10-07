import { omitUndefined } from "@strangecyan/vignette-core";
import {
  OBSWebSocket,
  type OBSRequestTypes,
  type RequestBatchRequest,
  type EventTypes,
  type OBSEventTypes,
} from "obs-websocket-js";
import { z } from "zod";

import type { ObsJsonObject } from "./operations.js";
import type {
  ObsBatchRequest,
  ObsBatchResponse,
  ObsConnectOptions,
  ObsConnectionInfo,
  ObsEventListener,
  ObsTransport,
} from "./transport.js";
import { ObsWireObjectSchema } from "./wire-schemas.js";

export class ObsWebSocketTransport implements ObsTransport {
  private readonly client = new OBSWebSocket();

  async connect(options: ObsConnectOptions): Promise<ObsConnectionInfo> {
    const result = await this.client.connect(options.url, options.password, {
      rpcVersion: options.rpcVersion ?? 1,
    });
    return {
      obsWebSocketVersion: result.obsWebSocketVersion,
      negotiatedRpcVersion: result.negotiatedRpcVersion,
    };
  }

  disconnect(): Promise<void> {
    return this.client.disconnect();
  }

  async call(requestType: string, requestData?: ObsJsonObject): Promise<ObsJsonObject> {
    // SAFETY: The planner and registered codecs own request names and their JSON payloads;
    // obs-websocket-js dispatches those same strings without performing runtime type checks.
    const nativeType = requestType as keyof OBSRequestTypes;
    // SAFETY: Request data is generated alongside its request type by the owning codec or executor.
    const nativeData = requestData as OBSRequestTypes[typeof nativeType];
    const value = await this.client.call(nativeType, nativeData);
    return value === undefined ? {} : ObsWireObjectSchema.parse(value);
  }

  async callBatch(requests: readonly ObsBatchRequest[]): Promise<readonly ObsBatchResponse[]> {
    const nativeRequests = requests.map((request) => {
      // SAFETY: Each codec/executor request pairs an OBS request name with its matching JSON payload.
      return request as RequestBatchRequest;
    });
    const values = await this.client.callBatch(nativeRequests);
    return values.map((value) => {
      const responseData =
        value.responseData === undefined ? {} : ObsWireObjectSchema.parse(value.responseData);
      return {
        requestType: value.requestType,
        ok: value.requestStatus.result,
        code: value.requestStatus.code,
        ...omitUndefined({
          comment: z
            .string()
            .safeParse("comment" in value.requestStatus ? value.requestStatus.comment : undefined)
            .data,
          responseData: Object.keys(responseData).length === 0 ? undefined : responseData,
        }),
      };
    });
  }

  on(event: string, listener: ObsEventListener): () => void {
    // SAFETY: The scheduler registers OBS event names; the client forwards their payloads by name.
    const nativeEvent = event as keyof OBSEventTypes | "ConnectionClosed" | "ConnectionError";
    const handler = (payload?: EventTypes[typeof nativeEvent]) => {
      listener(payload instanceof Error ? payload : ObsWireObjectSchema.safeParse(payload).data);
    };
    this.client.on(nativeEvent, handler);
    return () => {
      this.client.off(nativeEvent, handler);
    };
  }
}
