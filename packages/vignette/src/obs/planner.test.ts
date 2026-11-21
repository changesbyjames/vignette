import { describe, expect, it } from "vitest";

import { AudioChannelSchema, type AudioChannelInput } from "../core/audio.js";
import type { Item, Snapshot, Source } from "../core/snapshot.js";
import { OBS_DEFAULT_AUDIO, type ObsAudioState } from "./audio.js";
import { bootstrapObsState } from "./bootstrap.js";
import { executeObsPlan } from "./executor.js";
import { managedSceneName, managedSourceName, registrySceneName } from "./naming.js";
import type {
  ObservedObsFilter,
  ObservedObsSceneItem,
  ObservedObsState,
} from "./observed-state.js";
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

/** A channel with defaults filled in. */
function channel(input: AudioChannelInput) {
  return AudioChannelSchema.parse(input);
}

/** The default snapshot with an audio channel on `bg`. */
function audioSnapshot(input: AudioChannelInput): Snapshot {
  return snapshot({ sources: [{ ...source("bg"), audio: channel(input) }] });
}

/** A handle for `bg` whose input plays sound. */
function audioHandle(): ObsHandle {
  const { input } = colorHandle();
  return { input: { ...input, audio: true } };
}

/** `placedObserved()` with OBS reporting `bg`'s audio and filters. */
function audioObserved(
  audio: ObsAudioState = OBS_DEFAULT_AUDIO,
  filters: readonly ObservedObsFilter[] = [],
): ObservedObsState {
  const state = placedObserved();
  return { ...state, inputs: state.inputs.map((input) => ({ ...input, audio, filters })) };
}

/** A filter in the show's namespace. */
function managedFilter(
  id: string,
  filterKind: string,
  filterIndex: number,
  filterSettings: ObservedObsFilter["filterSettings"],
): ObservedObsFilter {
  return { filterName: `vignette/${show}/${id}`, filterKind, filterIndex, filterSettings };
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

  it("converges settings and each part of an input's audio that differs, once", () => {
    const desired = audioSnapshot({ volumeDb: -6, monitor: "monitor-and-output", tracks: [1, 2] });
    const handle: ObsHandle = {
      input: {
        kind: "color_source_v3",
        settings: { color: 1, width: 1920, height: 1080 },
        audio: true,
      },
    };
    const result = plan({ desired, observed: audioObserved(), handles: new Map([["bg", handle]]) });
    if (!result.ok) throw new Error(result.problems.join(" "));
    expect(result.plan.operations.map((operation) => operation.kind)).toEqual([
      "set-input-settings",
      "set-input-audio",
      "set-input-audio",
      "set-input-audio",
    ]);
    expect(result.plan.operations.slice(1)).toMatchObject([
      { change: { field: "volumeDb", value: -6 } },
      { change: { field: "monitorType", value: "OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT" } },
      {
        change: {
          field: "tracks",
          value: { "1": true, "2": true, "3": false, "4": false, "5": false, "6": false },
        },
      },
    ]);

    // OBS stores volume as a multiplier; a value within the tolerance is converged.
    const converged = audioObserved({
      ...OBS_DEFAULT_AUDIO,
      volumeDb: -6.02,
      monitorType: "OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT",
      tracks: { "1": true, "2": true, "3": false, "4": false, "5": false, "6": false },
    });
    expect(
      kinds({ desired, observed: converged, handles: new Map([["bg", audioHandle()]]) }),
    ).toEqual([]);
  });

  it("adds the show's master volume to every channel and mutes inputs of sources without one", () => {
    const desired = { ...audioSnapshot({ volumeDb: -6 }), mix: { volumeDb: -3 } };
    expect(
      plan({ desired, observed: audioObserved(), handles: new Map([["bg", audioHandle()]]) }),
    ).toMatchObject({
      plan: { operations: [{ change: { field: "volumeDb", value: -9 } }] },
    });
    // `audio={false}`: the source has no channel, and its input is only muted.
    expect(
      plan({ observed: audioObserved(), handles: new Map([["bg", audioHandle()]]) }),
    ).toMatchObject({ plan: { operations: [{ change: { field: "muted", value: true } }] } });
    // An input OBS reports no audio for is left alone.
    expect(
      kinds({ desired, observed: placedObserved(), handles: new Map([["bg", audioHandle()]]) }),
    ).toEqual([]);
  });

  it("converges managed filters in order and never touches an operator's", () => {
    const operator: ObservedObsFilter = {
      filterName: "Operator gate",
      filterKind: "noise_gate_filter",
      filterIndex: 0,
      filterSettings: {},
    };
    const gain = managedFilter("level", "gain_filter", 1, { db: 0 });
    const desired = audioSnapshot({
      filters: [
        { kind: "compressor", id: "comp" },
        { kind: "gain", id: "level", db: 3 },
      ],
    });
    const result = plan({
      desired,
      observed: audioObserved(OBS_DEFAULT_AUDIO, [
        operator,
        gain,
        managedFilter("old", "eq", 2, {}),
      ]),
      handles: new Map([["bg", audioHandle()]]),
    });
    if (!result.ok) throw new Error(result.problems.join(" "));
    expect(
      result.plan.operations.map((operation) =>
        "filterName" in operation ? `${operation.kind} ${operation.filterName}` : operation.kind,
      ),
    ).toEqual([
      "remove-filter vignette/show/old",
      "create-filter vignette/show/comp",
      "set-filter-settings vignette/show/level",
      // The new compressor goes after the gain, so the managed filters are restacked first.
      "set-filter-index vignette/show/comp",
      "set-filter-index vignette/show/level",
    ]);
    expect(result.plan.operations[1]).toMatchObject({
      filterKind: "compressor_filter",
      filterSettings: {
        ratio: 10,
        threshold: -18,
        attack_time: 6,
        release_time: 60,
        output_gain: 0,
      },
    });

    // In order, with the operator's filter first: nothing to do.
    const ordered = audioObserved(OBS_DEFAULT_AUDIO, [
      operator,
      managedFilter("comp", "compressor_filter", 1, {
        ratio: 10,
        threshold: -18,
        attack_time: 6,
        release_time: 60,
        output_gain: 0,
      }),
      managedFilter("level", "gain_filter", 2, { db: 3 }),
    ]);
    expect(
      kinds({ desired, observed: ordered, handles: new Map([["bg", audioHandle()]]) }),
    ).toEqual([]);
    // A filter whose kind changed is replaced.
    const changed = audioObserved(OBS_DEFAULT_AUDIO, [
      managedFilter("comp", "limiter_filter", 0, {}),
      managedFilter("level", "gain_filter", 1, { db: 3 }),
    ]);
    expect(
      kinds({ desired, observed: changed, handles: new Map([["bg", audioHandle()]]) }),
    ).toEqual(["remove-filter", "create-filter", "set-filter-index", "set-filter-index"]);
  });

  it("places a pictureless source as an enabled item outside the canvas, unstacked", () => {
    const desired = snapshot({
      sources: [source("bg"), { ...source("bed"), audio: channel({}) }],
      scenes: [{ id: "main", items: [item("main.0", "bg")], audio: ["bed"] }],
    });
    const handles = new Map([
      ["bg", colorHandle()],
      ["bed", { input: { kind: "browser_source", settings: {}, audio: true } }],
    ]);
    const result = plan({ desired, handles });
    if (!result.ok) throw new Error(result.problems.join(" "));
    const bed = result.plan.operations.filter((operation) =>
      "placement" in operation && operation.placement.kind === "created"
        ? operation.placement.layerId === "audio:bed"
        : operation.kind === "create-placement" && operation.sourceId === "bed",
    );
    expect(bed.map((operation) => operation.kind)).toEqual([
      "create-placement",
      "set-transform",
      "set-enabled",
    ]);
    expect(bed[1]).toMatchObject({ transform: { positionX: -2, boundsWidth: 1, boundsHeight: 1 } });
    expect(result.plan.operations.some((operation) => operation.kind === "set-order")).toBe(false);
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
