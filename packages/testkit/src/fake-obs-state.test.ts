import type { ColorSource, CompiledSnapshot } from "@strangecyan/vignette-core";
import {
  planObsUpdate,
  REQUIRED_OBS_REQUESTS,
  resolveObsCodecs,
  type ObservedObsState,
} from "@strangecyan/vignette-target-obs";

const codecs = resolveObsCodecs();
import { describe, expect, it } from "vitest";

import { applyFakeObsPlan } from "./fake-obs-state.js";
import { validateManagedOnlyPlan, validateObsPhaseOrder } from "./obs-plan-matchers.js";

describe("applyFakeObsPlan", () => {
  it("converges and preserves unmanaged resources after every partial boundary", () => {
    // Interrupt execution at every operation boundary, then verify replanning converges without changing foreign resources.
    const desired = snapshot();
    const initial = emptyObserved();
    const first = planObsUpdate({
      desired,
      observed: initial,
      resolvedAssets: new Map(),
      codecs,
    });
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

  it("keeps invisible placements and their inputs, toggling only enablement", () => {
    // Converge a hidden placement, then flip it visible and back; each flip must plan only enablement.
    const hidden = snapshot(false);
    const visible = snapshot(true);
    const prewarm = planObsUpdate({
      desired: hidden,
      observed: emptyObserved(),
      resolvedAssets: new Map(),
      codecs,
    });
    expect(prewarm.ok).toBe(true);
    if (!prewarm.ok) return;
    expect(prewarm.plan.operations.map((operation) => operation.kind)).toContain("create-input");
    expect(prewarm.plan.operations.map((operation) => operation.kind)).toContain(
      "create-placement",
    );
    expect(prewarm.plan.operations.map((operation) => operation.kind)).not.toContain("set-enabled");
    let state = applyFakeObsPlan({
      state: emptyObserved(),
      plan: prewarm.plan,
      projectId: hidden.projectId,
    }).state;

    for (const desired of [visible, hidden]) {
      const flip = planObsUpdate({ desired, observed: state, resolvedAssets: new Map(), codecs });
      expect(flip.ok).toBe(true);
      if (!flip.ok) return;
      expect(
        flip.plan.operations.map((operation) =>
          operation.kind === "set-enabled" ? [operation.kind, operation.enabled] : operation.kind,
        ),
      ).toEqual([["set-enabled", desired.scenes[0]?.items[0]?.visible]]);
      state = applyFakeObsPlan({ state, plan: flip.plan, projectId: desired.projectId }).state;
    }
  });
});

function snapshot(visible = true): CompiledSnapshot {
  const source = "background";
  const fixtureSource1 = {
    id: source,
    kind: "source:color",
    color: "#112233",
    size: { width: 1920, height: 1080 },
  } satisfies ColorSource;
  return {
    revision: 1,
    projectId: "fake-test",
    canvas: { width: 1920, height: 1080 },
    warnings: [],
    sources: [
      {
        id: source,
        definition: fixtureSource1,
      },
    ],
    scenes: [
      {
        id: "main",
        items: [
          {
            id: "background-layer",
            content: { kind: "source", sourceId: source },
            frame: { x: 0, y: 0, width: 1920, height: 1080 },
            visible,
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
