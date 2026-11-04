import { describe, expect, it } from "vitest";

import type { Item, Snapshot, Source } from "../core/snapshot.js";
import { bootstrapObsState } from "./bootstrap.js";
import { executeObsPlan } from "./executor.js";
import { managedSceneName, managedSourceName, registrySceneName } from "./naming.js";
import type { ObservedObsSceneItem, ObservedObsState } from "./observed-state.js";
import { planObsUpdate, type ObsPlannerInput } from "./planner.js";
import type { ObsHandle } from "./plugin.js";
import { FakeObs } from "./testing.js";

const show = "show";

function item(id: string, sourceId: string, overrides: Partial<Item> = {}): Item {
  const frame = overrides.frame ?? { x: 0, y: 0, width: 1920, height: 1080 };
  return {
    id,
    sourceId,
    frame,
    placement: {
      destination: frame,
      sourceCrop: { top: 0, right: 0, bottom: 0, left: 0 },
      alignment: { horizontal: "center", vertical: "center" },
    },
    visible: true,
    opacity: 1,
    rotation: 0,
    kind: "layer",
    props: {},
    ...overrides,
  };
}

function source(id: string, size = { width: 1920, height: 1080 }): Source {
  return { id, kind: "color", props: { color: "#ff0000" }, size };
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    revision: 1,
    id: show,
    canvas: { width: 1920, height: 1080 },
    sources: [source("bg")],
    scenes: [{ id: "main", items: [item("main.0", "bg")] }],
    ...overrides,
  };
}

function colorHandle(color = 4_278_190_335): ObsHandle {
  return { input: { kind: "color_source_v3", settings: { color, width: 1920, height: 1080 } } };
}

function observed(overrides: Partial<ObservedObsState> = {}): ObservedObsState {
  return {
    show,
    inputKinds: ["color_source_v3", "browser_source"],
    missingRequests: [],
    scenes: [],
    inputs: [],
    sceneItems: [],
    ...overrides,
  };
}

function plan(input: Partial<ObsPlannerInput>) {
  return planObsUpdate({
    desired: snapshot(),
    observed: observed(),
    handles: new Map([["bg", colorHandle()]]),
    ...input,
  });
}

function kinds(input: Partial<ObsPlannerInput>): readonly string[] {
  const result = plan(input);
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result.plan.operations.map((operation) => operation.kind);
}

function problems(input: Partial<ObsPlannerInput>): string {
  const result = plan(input);
  if (result.ok) throw new Error("Expected planning to fail.");
  return result.problems.join(" ");
}

/** The managed scene `main` and input `bg`, with one item of `bg` in `main`. */
function placedObserved(extra: readonly ObservedObsSceneItem[] = []): ObservedObsState {
  return observed({
    scenes: [
      { sceneName: registrySceneName(show), sceneUuid: "registry-1" },
      { sceneName: managedSceneName(show, "main"), sceneUuid: "scene-1" },
    ],
    inputs: [
      {
        inputName: managedSourceName(show, "bg"),
        inputUuid: "input-1",
        inputKind: "color_source_v3",
        inputSettings: { color: 4_278_190_335, width: 1920, height: 1080 },
      },
    ],
    sceneItems: [
      sceneItem("registry-1", 1, "bg", "input-1", 0),
      sceneItem("scene-1", 2, "bg", "input-1", 0),
      ...extra,
    ],
  });
}

function sceneItem(
  sceneUuid: string,
  sceneItemId: number,
  sourceId: string,
  sourceUuid: string,
  sceneItemIndex: number,
): ObservedObsSceneItem {
  return {
    sceneUuid,
    sceneItemId,
    sceneItemIndex,
    sourceName: managedSourceName(show, sourceId),
    sourceUuid,
    sceneItemEnabled: true,
    sceneItemTransform: {
      positionX: 0,
      positionY: 0,
      rotation: 0,
      kind: "layer",
      props: {},
      alignment: 5,
      boundsType: "OBS_BOUNDS_STRETCH",
      boundsAlignment: 5,
      boundsWidth: 1920,
      boundsHeight: 1080,
      cropTop: 0,
      cropRight: 0,
      cropBottom: 0,
      cropLeft: 0,
    },
  };
}

describe("planObsUpdate", () => {
  it("builds resources in dependency order and enables placements last", () => {
    expect(kinds({})).toEqual([
      "create-scene",
      "create-scene",
      "create-input",
      "create-placement",
      "set-transform",
      "set-enabled",
    ]);
  });

  it("plans nothing once OBS matches what its own plan produced", async () => {
    const obs = new FakeObs();
    await obs.connect({ url: "ws://fake" });
    const desired = snapshot({
      sources: [source("bg"), source("logo", { width: 400, height: 200 })],
      scenes: [
        { id: "main", items: [item("main.0", "bg"), item("main.1", "logo")] },
        { id: "brb", items: [item("brb.0", "logo", { visible: false })] },
      ],
      activeScene: "brb",
    });
    const handles = new Map([
      ["bg", colorHandle()],
      ["logo", colorHandle(4_278_255_360)],
    ]);
    const first = planObsUpdate({ desired, observed: await bootstrapObsState(obs, show), handles });
    if (!first.ok) throw new Error(first.problems.join(" "));
    await executeObsPlan(obs, first.plan, () => true);

    const second = planObsUpdate({
      desired,
      observed: await bootstrapObsState(obs, show),
      handles,
      settledActiveScene: "brb",
    });
    expect(second).toEqual({ ok: true, plan: { show, revision: 1, operations: [] } });
    expect(obs.programSceneName).toBe(managedSceneName(show, "brb"));
  });

  it("blocks planning when one source is placed twice in a managed scene", () => {
    expect(
      problems({ observed: placedObserved([sceneItem("scene-1", 3, "bg", "input-1", 1)]) }),
    ).toContain("more than once");
  });

  it("translates canvas clipping into OBS crop and visible bounds", () => {
    const frame = { x: 0, y: 0, width: 200, height: 200 };
    const result = plan({
      desired: snapshot({
        sources: [source("bg", { width: 100, height: 100 })],
        scenes: [
          {
            id: "main",
            items: [
              item("main.0", "bg", { frame, clip: { x: 50, y: 25, width: 100, height: 150 } }),
            ],
          },
        ],
      }),
    });
    if (!result.ok) throw new Error(result.problems.join(" "));
    // The item is 2x its 100px source, so the 50px and 25px cut edges are 25px and 12.5px of source.
    expect(
      result.plan.operations.find((operation) => operation.kind === "set-transform"),
    ).toMatchObject({
      transform: {
        positionX: 50,
        positionY: 25,
        boundsWidth: 100,
        boundsHeight: 150,
        cropLeft: 25,
        cropRight: 25,
        cropTop: 12.5,
        cropBottom: 12.5,
      },
    });
  });

  it("removes stale items and scenes before the inputs they place, and never foreign ones", () => {
    const state = placedObserved();
    const result = plan({
      desired: snapshot({ sources: [], scenes: [] }),
      handles: new Map(),
      observed: {
        ...state,
        scenes: [...state.scenes, { sceneName: "Operator scene", sceneUuid: "foreign-1" }],
        inputs: [
          ...state.inputs,
          {
            inputName: "vignette/other-show/bg",
            inputUuid: "foreign-2",
            inputKind: "color_source_v3",
            inputSettings: {},
          },
        ],
      },
    });
    if (!result.ok) throw new Error(result.problems.join(" "));
    expect(result.plan.operations.map((operation) => operation.kind)).toEqual([
      "remove-placement",
      "remove-scene",
      "remove-input",
    ]);
    expect(result.plan.operations.at(-1)).toMatchObject({
      inputUuid: "input-1",
      dependsOn: ["placement:remove:registry-1:1", "scene:remove:main"],
    });
  });

  it("restacks a scene only when its items' relative order is wrong", () => {
    const state = placedObserved();
    const withLogo: ObservedObsState = {
      ...state,
      inputs: [
        ...state.inputs,
        {
          inputName: managedSourceName(show, "logo"),
          inputUuid: "input-2",
          inputKind: "color_source_v3",
          inputSettings: { color: 4_278_190_335, width: 1920, height: 1080 },
        },
      ],
      sceneItems: [
        sceneItem("registry-1", 1, "bg", "input-1", 0),
        sceneItem("registry-1", 3, "logo", "input-2", 1),
        // An operator's item between the two keeps the order valid as long as bg is below logo.
        sceneItem("scene-1", 2, "bg", "input-1", 0),
        { ...sceneItem("scene-1", 5, "x", "foreign", 1), sourceName: "Webcam" },
        sceneItem("scene-1", 4, "logo", "input-2", 2),
      ],
    };
    const desired = (order: readonly string[]) =>
      snapshot({
        sources: [source("bg"), source("logo")],
        scenes: [{ id: "main", items: order.map((id) => item(`main.${id}`, id)) }],
      });
    const handles = new Map([
      ["bg", colorHandle()],
      ["logo", colorHandle()],
    ]);

    expect(
      kinds({ desired: desired(["bg", "logo"]), observed: withLogo, handles }).filter(
        (kind) => kind === "set-order",
      ),
    ).toEqual([]);
    expect(
      kinds({ desired: desired(["logo", "bg"]), observed: withLogo, handles }).filter(
        (kind) => kind === "set-order",
      ),
    ).toEqual(["set-order", "set-order"]);
  });

  it("leaves the input and items of a source without a handle as they are", () => {
    expect(kinds({ observed: placedObserved(), handles: new Map() })).toEqual([]);
    expect(kinds({ handles: new Map() })).toEqual(["create-scene", "create-scene"]);
  });

  it("converges settings and mute state of an existing input", () => {
    const state = placedObserved();
    const handle: ObsHandle = {
      input: {
        kind: "color_source_v3",
        settings: { color: 1, width: 1920, height: 1080 },
        muted: true,
      },
    };
    expect(kinds({ observed: state, handles: new Map([["bg", handle]]) })).toEqual([
      "set-input-settings",
      "set-input-mute",
    ]);
  });

  it("sets the program scene only when activeScene changed since the last settled snapshot", () => {
    const desired = snapshot({ activeScene: "main" });
    expect(kinds({ desired })).toContain("set-program-scene");
    expect(plan({ desired })).toMatchObject({
      plan: {
        operations: expect.arrayContaining([
          expect.objectContaining({ kind: "set-program-scene", dependsOn: ["scene:create:main"] }),
        ]),
      },
    });
    // The operator switched away; re-observing must not switch back.
    expect(kinds({ desired, observed: placedObserved(), settledActiveScene: "main" })).toEqual([]);
    // Already on air.
    expect(
      kinds({
        desired,
        observed: { ...placedObserved(), programSceneName: managedSceneName(show, "main") },
      }),
    ).toEqual([]);
  });

  describe("layer kinds", () => {
    const motion = (props: Item["props"] = { animate: { x: 10 } }) =>
      item("main.0", "bg", { kind: "motion", props });
    const desired = (props?: Item["props"]) =>
      snapshot({ scenes: [{ id: "main", items: [motion(props)] }] });

    it("hands an item of a kind with a plugin to it instead of transforming it", () => {
      const result = kinds({ desired: desired(), layers: new Set(["motion"]) });
      expect(result).toContain("place-item");
      expect(result).not.toContain("set-transform");
      expect(result).not.toContain("set-enabled");
      expect(result.indexOf("place-item")).toBeGreaterThan(result.indexOf("create-placement"));
    });

    it("treats a kind without a plugin as a plain layer", () => {
      const result = kinds({ desired: desired(), layers: new Set() });
      expect(result).toContain("set-transform");
      expect(result).not.toContain("place-item");
    });

    it("hands an item over again only when it changed since it was last placed", () => {
      const same = plan({
        desired: desired(),
        observed: placedObserved(),
        layers: new Set(["motion"]),
        placed: new Map([["main:main.0", motion()]]),
      });
      if (!same.ok) throw new Error(same.problems.join(" "));
      expect(same.plan.operations).toEqual([]);

      const changed = plan({
        desired: desired({ animate: { x: 20 } }),
        observed: placedObserved(),
        layers: new Set(["motion"]),
        placed: new Map([["main:main.0", motion()]]),
      });
      if (!changed.ok) throw new Error(changed.problems.join(" "));
      expect(changed.plan.operations).toMatchObject([
        { kind: "place-item", item: { id: "main.0" }, previous: { props: { animate: { x: 10 } } } },
      ]);
    });

    it("releases a handed-over item through its plugin, then removes it", () => {
      const result = plan({
        desired: snapshot({ scenes: [{ id: "main", items: [] }] }),
        observed: placedObserved(),
        layers: new Set(["motion"]),
        placed: new Map([["main:main.0", motion()]]),
        previous: desired(),
      });
      if (!result.ok) throw new Error(result.problems.join(" "));
      expect(result.plan.operations.map((operation) => operation.kind)).toEqual([
        "release-placement",
      ]);
      expect(result.plan.operations[0]).toMatchObject({ sceneId: "main", item: { id: "main.0" } });
    });
  });

  it("refuses snapshots OBS cannot represent safely", () => {
    expect(problems({ observed: observed({ missingRequests: ["CreateScene"] }) })).toContain(
      "'CreateScene'",
    );
    expect(
      problems({
        desired: snapshot({ scenes: [{ id: "bg", items: [] }] }),
      }),
    ).toContain("would both be named 'vignette/show/bg'");
    expect(
      problems({ handles: new Map([["bg", { input: { kind: "moq_source", settings: {} } }]]) }),
    ).toContain("no input kind 'moq_source'");
    const state = placedObserved();
    const browser: ObsHandle = { input: { kind: "browser_source", settings: {} } };
    expect(problems({ observed: state, handles: new Map([["bg", browser]]) })).toContain(
      "is a 'color_source_v3'",
    );
    expect(problems({ observed: observed({ show: "other" }) })).toContain("for show 'other'");
  });
});
