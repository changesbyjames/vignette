import {
  layerId,
  projectId,
  sceneId,
  sourceId,
  type BrowserSource,
  type ColorSource,
  type CompiledSnapshot,
} from "@cbj/vignette-core";
import { describe, expect, it } from "vitest";

import { REQUIRED_OBS_REQUESTS } from "./capabilities.js";
import { managedSceneName, managedSourceName, registrySceneName } from "./naming.js";
import type { ObservedObsState } from "./observed-state.js";
import { resolveObsCodecs } from "./codecs/index.js";
import { planObsUpdate } from "./planner.js";

const codecs = resolveObsCodecs();
const project = projectId("show");
const scene = sceneId("main");
const source = sourceId("background");
const layer = layerId("background-layer");

describe("planObsUpdate", () => {
  it("builds resources in dependency order and enables placements last", () => {
    const result = planObsUpdate({
      desired: snapshot(),
      observed: emptyObserved(),
      resolvedAssets: new Map(),
      codecs,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.operations.map((operation) => operation.kind)).toEqual([
      "create-scene",
      "create-scene",
      "create-input",
      "create-placement",
      "set-transform",
      "set-order",
      "set-enabled",
    ]);
    expect(result.plan.operations.at(-1)?.phase).toBe("enable");
  });

  it("blocks destructive work when placement identity is ambiguous", () => {
    const observed = emptyObserved({
      scenes: [
        { sceneName: managedSceneName(project, scene), sceneUuid: "scene-1", sceneIndex: 0 },
      ],
      inputs: [
        {
          inputName: managedSourceName(project, source),
          inputUuid: "input-1",
          inputKind: "color_source_v3",
          inputSettings: { color: 4_294_901_760, width: 1920, height: 1080 },
        },
      ],
      sceneItems: [item(1), item(2)],
    });
    const result = planObsUpdate({
      desired: snapshot(),
      observed,
      resolvedAssets: new Map(),
      codecs,
    });

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.code === "OBS_AMBIGUOUS_PLACEMENT"),
    ).toBe(true);
  });

  it("translates inherited clipping into OBS crop and visible bounds", () => {
    const desired = snapshot();
    const baseItem = desired.scenes[0]?.items[0];
    if (baseItem === undefined) throw new Error("Fixture item is missing.");
    const clipped: CompiledSnapshot = {
      ...desired,
      sources: [
        {
          id: source,
          definition: {
            id: source,
            kind: "source:color",
            color: "#ff0000",
            size: { width: 100, height: 100 },
          } as ColorSource,
          intrinsicSize: { width: 100, height: 100 },
        },
      ],
      scenes: [
        {
          id: scene,
          items: [
            {
              ...baseItem,
              frame: { x: 0, y: 0, width: 200, height: 200 },
              clip: { x: 50, y: 25, width: 100, height: 150 },
              placement: {
                destination: { x: 0, y: 0, width: 200, height: 200 },
                sourceCrop: { top: 0, right: 0, bottom: 0, left: 0 },
                alignment: { horizontal: "center", vertical: "center" },
              },
            },
          ],
        },
      ],
    };

    const result = planObsUpdate({
      desired: clipped,
      observed: emptyObserved(),
      resolvedAssets: new Map(),
      codecs,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const transform = result.plan.operations.find(
      (operation) => operation.kind === "set-transform",
    );
    expect(transform).toMatchObject({
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

  it("rejects clipped sources without explicit intrinsic dimensions", () => {
    const desired = snapshot();
    const definition = desired.sources[0]?.definition;
    const baseItem = desired.scenes[0]?.items[0];
    if (definition?.kind !== "source:color" || baseItem === undefined) {
      throw new Error("Fixture is malformed.");
    }
    const colorDefinition = definition as ColorSource;
    const result = planObsUpdate({
      desired: {
        ...desired,
        sources: [
          {
            id: source,
            definition: {
              id: colorDefinition.id,
              kind: "source:color",
              color: colorDefinition.color,
              ...(colorDefinition.label === undefined ? {} : { label: colorDefinition.label }),
            } as ColorSource,
          },
        ],
        scenes: [
          {
            id: scene,
            items: [{ ...baseItem, clip: { x: 0, y: 0, width: 100, height: 100 } }],
          },
        ],
      },
      observed: emptyObserved(),
      resolvedAssets: new Map(),
      codecs,
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "OBS_UNSUPPORTED_FEATURE", severity: "error" }),
      ]),
    );
  });

  it("removes the registry placement before its final unreferenced input", () => {
    const result = planObsUpdate({
      desired: { ...snapshot(), sources: [], scenes: [] },
      observed: emptyObserved({
        scenes: [
          {
            sceneName: registrySceneName(project),
            sceneUuid: "registry-1",
            sceneIndex: 0,
          },
          { sceneName: managedSceneName(project, scene), sceneUuid: "scene-1", sceneIndex: 1 },
        ],
        inputs: [
          {
            inputName: managedSourceName(project, source),
            inputUuid: "input-1",
            inputKind: "color_source_v3",
            inputSettings: { color: 4_294_901_760, width: 1920, height: 1080 },
          },
        ],
        sceneItems: [
          {
            sceneUuid: "registry-1",
            sceneItemId: 1,
            sceneItemIndex: 0,
            sourceName: managedSourceName(project, source),
            sourceUuid: "input-1",
            sceneItemEnabled: false,
          },
          item(2),
        ],
      }),
      resolvedAssets: new Map(),
      codecs,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.operations.map((operation) => operation.kind)).toEqual([
      "remove-placement",
      "remove-scene",
      "remove-input",
    ]);
    expect(result.plan.operations.at(-1)?.dependsOn).toEqual([
      "placement:remove:registry-1:1",
      "scene:remove:main",
    ]);
  });

  it("renders browser inputs at their realized canvas size", () => {
    const result = planObsUpdate({
      desired: browserSnapshot(560, 315),
      observed: browserObserved(),
      resolvedAssets: new Map(),
      codecs,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.plan.operations.find((operation) => operation.kind === "create-input"),
    ).toMatchObject({
      inputSettings: { width: 560, height: 315 },
    });
    expect(
      result.plan.operations.find((operation) => operation.kind === "set-transform"),
    ).toMatchObject({
      transform: {
        boundsWidth: 560,
        boundsHeight: 315,
        cropTop: 0,
        cropRight: 0,
        cropBottom: 0,
        cropLeft: 0,
      },
    });
  });

  it("rescales browser crop coordinates into the realized viewport", () => {
    const desired = browserSnapshot(500, 500);
    const baseItem = desired.scenes[0]?.items[0];
    if (baseItem === undefined) throw new Error("Browser fixture item is missing.");
    const result = planObsUpdate({
      desired: {
        ...desired,
        scenes: [
          {
            id: scene,
            items: [
              {
                ...baseItem,
                placement: {
                  destination: { x: 0, y: 0, width: 500, height: 500 },
                  sourceCrop: { top: 0, right: 280, bottom: 0, left: 280 },
                  alignment: { horizontal: "center", vertical: "center" },
                },
              },
            ],
          },
        ],
      },
      observed: browserObserved(),
      resolvedAssets: new Map(),
      codecs,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.plan.operations.find((operation) => operation.kind === "create-input"),
    ).toMatchObject({ inputSettings: { width: 889, height: 500 } });
    expect(
      result.plan.operations.find((operation) => operation.kind === "set-transform"),
    ).toMatchObject({
      transform: { cropLeft: 194.4688, cropRight: 194.4688 },
    });
  });

  it("rejects one browser input realized at conflicting sizes", () => {
    const desired = browserSnapshot(560, 315);
    const firstScene = desired.scenes[0];
    const firstItem = firstScene?.items[0];
    if (firstScene === undefined || firstItem === undefined) {
      throw new Error("Browser fixture is missing.");
    }
    const result = planObsUpdate({
      desired: {
        ...desired,
        scenes: [
          firstScene,
          {
            id: sceneId("secondary"),
            items: [
              {
                ...firstItem,
                id: layerId("secondary-browser-layer"),
                frame: { x: 0, y: 0, width: 640, height: 360 },
                placement: {
                  destination: { x: 0, y: 0, width: 640, height: 360 },
                  sourceCrop: { top: 0, right: 0, bottom: 0, left: 0 },
                  alignment: { horizontal: "center", vertical: "center" },
                },
              },
            ],
          },
        ],
      },
      observed: browserObserved(),
      resolvedAssets: new Map(),
      codecs,
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "OBS_UNSUPPORTED_FEATURE",
          message: expect.stringContaining("560x315 and 640x360"),
        }),
      ]),
    );
  });
});

function snapshot(): CompiledSnapshot {
  return {
    revision: 1,
    projectId: project,
    canvas: { width: 1920, height: 1080 },
    warnings: [],
    sources: [
      {
        id: source,
        definition: {
          id: source,
          kind: "source:color",
          color: "#ff0000",
          size: { width: 1920, height: 1080 },
        } as ColorSource,
      },
    ],
    scenes: [
      {
        id: scene,
        items: [
          {
            id: layer,
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

function browserSnapshot(width: number, height: number): CompiledSnapshot {
  const browser = sourceId("browser");
  return {
    revision: 1,
    projectId: project,
    canvas: { width: 1920, height: 1080 },
    warnings: [],
    sources: [
      {
        id: browser,
        definition: {
          id: browser,
          kind: "source:browser",
          url: "http://127.0.0.1:4173/frame",
          viewport: { width: 1280, height: 720 },
        } as BrowserSource,
      },
    ],
    scenes: [
      {
        id: scene,
        items: [
          {
            id: layerId("browser-layer"),
            content: { kind: "source", sourceId: browser },
            frame: { x: 0, y: 0, width, height },
            placement: {
              destination: { x: 0, y: 0, width, height },
              sourceCrop: { top: 0, right: 0, bottom: 0, left: 0 },
              alignment: { horizontal: "center", vertical: "center" },
            },
            visible: true,
            opacity: 1,
            rotation: 0,
          },
        ],
      },
    ],
  };
}

function emptyObserved(overrides: Partial<ObservedObsState> = {}): ObservedObsState {
  return {
    observationEpoch: 1,
    capabilities: {
      obsVersion: "32.0.0",
      obsWebSocketVersion: "5.6.0",
      rpcVersion: 1,
      availableRequests: REQUIRED_OBS_REQUESTS,
      inputKinds: ["color_source_v3"],
      platform: "macos",
    },
    scenes: [],
    inputs: [],
    sceneItems: [],
    ...overrides,
  };
}

function browserObserved(): ObservedObsState {
  return emptyObserved({
    capabilities: {
      ...emptyObserved().capabilities,
      inputKinds: ["browser_source"],
    },
  });
}

function item(sceneItemId: number) {
  return {
    sceneUuid: "scene-1",
    sceneItemId,
    sceneItemIndex: sceneItemId - 1,
    sourceName: managedSourceName(project, source),
    sourceUuid: "input-1",
    sceneItemEnabled: true,
  };
}
