import { describe, expect, it } from "vitest";

import { executeObsPlan } from "./executor.js";
import type { ObsPlan } from "./operations.js";
import { FakeObs } from "./testing.js";

/** A connected fake OBS holding one show scene and one registered input. */
async function connectedObs(): Promise<FakeObs> {
  const obs = new FakeObs();
  await obs.connect({ url: "ws://fake" });
  await obs.call("CreateScene", { sceneName: "vignette/show" });
  await obs.call("CreateScene", { sceneName: "vignette/show/main" });
  await obs.call("CreateInput", {
    sceneName: "vignette/show",
    inputName: "vignette/show/video",
    inputKind: "ffmpeg_source",
    inputSettings: {},
    sceneItemEnabled: false,
  });
  obs.requests.length = 0;
  return obs;
}

const plan: ObsPlan = {
  show: "show",
  revision: 3,
  operations: [
    {
      kind: "create-placement",
      key: "create",
      phase: "placements",
      dependsOn: [],
      destructive: false,
      sceneId: "main",
      layerId: "video-layer",
      sourceId: "video",
    },
    {
      kind: "set-enabled",
      key: "enable",
      phase: "enable",
      dependsOn: ["create"],
      destructive: false,
      placement: { kind: "created", sceneId: "main", layerId: "video-layer" },
      enabled: true,
    },
    {
      kind: "set-program-scene",
      key: "program",
      phase: "program",
      dependsOn: [],
      destructive: false,
      sceneId: "main",
    },
  ],
};

describe("executeObsPlan", () => {
  it("addresses created scene items by the ID OBS returned, in later phases", async () => {
    // Enabling the new item must use the ID from CreateSceneItem's response.
    const obs = await connectedObs();

    expect(await executeObsPlan(obs, plan, () => true)).toEqual({ interrupted: false });

    const created = obs.scenes.find((scene) => scene.sceneName === "vignette/show/main")?.items[0];
    expect(obs.requests.map((request) => request.requestType)).toEqual([
      "CreateSceneItem",
      "SetSceneItemEnabled",
      "SetCurrentProgramScene",
    ]);
    expect(obs.requests[1]?.requestData).toEqual({
      sceneName: "vignette/show/main",
      sceneItemId: created?.sceneItemId,
      sceneItemEnabled: true,
    });
    expect(created?.sceneItemEnabled).toBe(true);
    expect(obs.programSceneName).toBe("vignette/show/main");
  });

  it("stops before the next phase once its observation is no longer valid", async () => {
    const obs = await connectedObs();
    let valid = true;
    const original = obs.call.bind(obs);
    obs.call = async (requestType, requestData) => {
      const response = await original(requestType, requestData);
      valid = false;
      return response;
    };

    expect(await executeObsPlan(obs, plan, () => valid)).toEqual({ interrupted: true });
    expect(obs.requests.map((request) => request.requestType)).toEqual(["CreateSceneItem"]);
  });

  it("counts removing something OBS no longer has as done", async () => {
    const obs = await connectedObs();
    const removal: ObsPlan = {
      show: "show",
      revision: 4,
      operations: [
        {
          kind: "remove-input",
          key: "input:remove:gone",
          phase: "remove-inputs",
          dependsOn: [],
          destructive: true,
          inputUuid: "no-such-input",
        },
      ],
    };

    await expect(executeObsPlan(obs, removal, () => true)).resolves.toEqual({
      interrupted: false,
    });
  });

  it("names the operation whose request failed", async () => {
    const obs = await connectedObs();
    obs.fail("SetCurrentProgramScene", new Error("refused"));

    await expect(executeObsPlan(obs, plan, () => true)).rejects.toMatchObject({
      operationKey: "program",
    });
  });
});
