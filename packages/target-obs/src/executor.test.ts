import { layerId, projectId, sceneId, sourceId } from "@cbj/react-obs-core";
import { describe, expect, it } from "vitest";

import { executeObsPlan } from "./executor.js";
import type { ObsJsonObject, ObsPlan } from "./operations.js";
import type {
  ObsBatchRequest,
  ObsBatchResponse,
  ObsConnectionInfo,
  ObsTransport,
} from "./transport.js";

describe("executeObsPlan", () => {
  it("uses the scene item receipt in later phases", async () => {
    const transport = new RecordingTransport();
    const scene = sceneId("main");
    const layer = layerId("video-layer");
    const plan: ObsPlan = {
      revision: 3,
      observationEpoch: 1,
      operations: [
        {
          kind: "create-placement",
          key: "create",
          phase: "placements",
          dependsOn: [],
          destructive: false,
          layerId: layer,
          scene: { kind: "scene", sceneId: scene },
          content: { kind: "input", sourceId: sourceId("video") },
        },
        {
          kind: "set-enabled",
          key: "enable",
          phase: "enable",
          dependsOn: ["create"],
          destructive: false,
          placement: { kind: "created", layerId: layer, scene: { kind: "scene", sceneId: scene } },
          enabled: true,
        },
      ],
    };

    await executeObsPlan(transport, plan, {
      projectId: projectId("show"),
      isCurrentRevision: () => true,
    });

    expect(transport.requests).toEqual([
      [
        "CreateSceneItem",
        {
          sceneName: "react-obs::show::scene::main",
          sourceName: "react-obs::show::source::video",
          sceneItemEnabled: false,
        },
      ],
      [
        "SetSceneItemEnabled",
        {
          sceneName: "react-obs::show::scene::main",
          sceneItemId: 41,
          sceneItemEnabled: true,
        },
      ],
    ]);
  });
});

class RecordingTransport implements ObsTransport {
  readonly requests: [string, ObsJsonObject | undefined][] = [];

  connect(): Promise<ObsConnectionInfo> {
    return Promise.resolve({ obsWebSocketVersion: "fake", negotiatedRpcVersion: 1 });
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  call(requestType: string, requestData?: ObsJsonObject): Promise<ObsJsonObject> {
    this.requests.push([requestType, requestData]);
    return Promise.resolve(requestType === "CreateSceneItem" ? { sceneItemId: 41 } : {});
  }

  async callBatch(requests: readonly ObsBatchRequest[]): Promise<readonly ObsBatchResponse[]> {
    const responses: ObsBatchResponse[] = [];
    for (const request of requests) {
      const responseData = await this.call(request.requestType, request.requestData);
      responses.push({
        requestType: request.requestType,
        ok: true,
        code: 100,
        responseData,
      });
    }
    return responses;
  }

  on(): () => void {
    return () => undefined;
  }
}
