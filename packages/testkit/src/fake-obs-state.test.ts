import { layerId, projectId, sceneId, sourceId, type CompiledSnapshot } from "@cbj/vignette-core";
import {
  planObsUpdate,
  REQUIRED_OBS_REQUESTS,
  resolveObsCodecs,
  type ObservedObsState,
} from "@cbj/vignette-target-obs";

const codecs = resolveObsCodecs();
import { describe, expect, it } from "vitest";

import { applyFakeObsPlan } from "./fake-obs-state.js";
import { validateManagedOnlyPlan, validateObsPhaseOrder } from "./obs-plan-matchers.js";

describe("applyFakeObsPlan", () => {
  it("converges and preserves unmanaged resources after every partial boundary", () => {
    const desired = snapshot();
    const initial = emptyObserved();
    const first = planObsUpdate({ desired, observed: initial, resolvedAssets: new Map(), codecs });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(validateObsPhaseOrder(first.plan)).toEqual([]);
    expect(validateManagedOnlyPlan(first.plan, initial, desired.projectId)).toEqual([]);

    for (let stopAfter = 0; stopAfter <= first.plan.operations.length; stopAfter += 1) {
      const partial = applyFakeObsPlan({
        state: initial,
        plan: first.plan,
        projectId: desired.projectId,
        stopAfter,
      });
      const recovery = planObsUpdate({
        desired,
        observed: partial.state,
        resolvedAssets: new Map(),
        codecs,
      });
      expect(recovery.ok).toBe(true);
      if (!recovery.ok) continue;
      const converged = applyFakeObsPlan({
        state: partial.state,
        plan: recovery.plan,
        projectId: desired.projectId,
      });
      const noOp = planObsUpdate({
        desired,
        observed: converged.state,
        resolvedAssets: new Map(),
        codecs,
      });
      expect(noOp.ok).toBe(true);
      if (noOp.ok) expect(noOp.plan.operations).toEqual([]);
      expect(converged.state.scenes.some((scene) => scene.sceneName === "unmanaged-scene")).toBe(
        true,
      );
    }
  });
});

function snapshot(): CompiledSnapshot {
  const source = sourceId("background");
  return {
    revision: 1,
    projectId: projectId("fake-test"),
    canvas: { width: 1920, height: 1080 },
    warnings: [],
    sources: [
      {
        id: source,
        definition: {
          id: source,
          kind: "source:color",
          color: "#112233",
          size: { width: 1920, height: 1080 },
        },
      },
    ],
    scenes: [
      {
        id: sceneId("main"),
        items: [
          {
            id: layerId("background-layer"),
            content: { kind: "source", sourceId: source },
            frame: { x: 0, y: 0, width: 1920, height: 1080 },
            visible: true,
            opacity: 1,
            rotation: 0,
          },
        ],
      },
    ],
  };
}

function emptyObserved(): ObservedObsState {
  return {
    observationEpoch: 1,
    capabilities: {
      obsVersion: "32.0.0",
      obsWebSocketVersion: "5.6.0",
      rpcVersion: 1,
      availableRequests: REQUIRED_OBS_REQUESTS,
      inputKinds: ["color_source_v3"],
      platform: "test",
    },
    scenes: [{ sceneName: "unmanaged-scene", sceneUuid: "unmanaged-uuid", sceneIndex: 0 }],
    inputs: [],
    sceneItems: [],
  };
}
