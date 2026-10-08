import {
  asset,
  consumeStream,
  type AssetResolver,
  type BrowserSource,
  type ColorSource,
  type CompiledSnapshot,
  type ImageSource,
  type StreamMessage,
} from "@strangecyan/vignette-core";
import {
  createObsTargetWithTransport,
  OBSRuntime,
  managedSceneName,
  managedSourceName,
  registrySceneName,
  REQUIRED_OBS_REQUESTS,
  type ObsJsonObject,
} from "@strangecyan/vignette-target-obs";
import { describe, expect, it, vi } from "vitest";

import { FakeObsTransport } from "./fake-obs-transport.js";
import { ManualClock } from "./manual-clock.js";

describe("OBS convergence scheduler", () => {
  it("settles the preceding snapshot before selecting a scene from the stream", async () => {
    const transport = new FakeObsTransport();
    enqueueEmptyObservation(transport);
    const connected = deferred<undefined>();
    const createdScene = deferred<ObsJsonObject>();
    const originalConnect = transport.connect.bind(transport);
    const connect = vi.spyOn(transport, "connect").mockImplementation(async (options) => {
      await connected.promise;
      return originalConnect(options);
    });
    transport
      .enqueue("CreateScene", createdScene.promise, {})
      .enqueue("CreateInput", { inputUuid: "input-background", sceneItemId: 1 })
      .enqueue("CreateSceneItem", { sceneItemId: 2 });
    enqueueConvergedObservation(transport, "scheduler-test");
    const runtime = new OBSRuntime({ projectId: "scheduler-test", transport });
    const select = vi.spyOn(runtime, "event");
    async function* messages(): AsyncIterable<StreamMessage> {
      yield await Promise.resolve({
        kind: "setup",
        projectId: "scheduler-test",
        manifest: { version: 1, assets: [] },
        extensions: [],
      });
      yield { kind: "update", snapshot: snapshot(1) };
      yield { kind: "event", event: { id: "select-main", kind: "scene:select", sceneId: "main" } };
    }
    const consuming = consumeStream(runtime, messages());
    // Attach rejection handling before releasing either deliberately blocked operation.
    const result = consuming.then(
      () => true,
      () => false,
    );
    try {
      // Wait through asset setup, then hold the connection open as the stream delivers its event.
      await expect.poll(() => select.mock.calls.length).toBe(1);
      expect(connect).toHaveBeenCalledTimes(1);
      connected.resolve(undefined);
      await expect
        .poll(() => transport.requests.some((request) => request.requestType === "CreateScene"))
        .toBe(true);
      expect(
        transport.requests.some((request) => request.requestType === "SetCurrentProgramScene"),
      ).toBe(false);
      createdScene.resolve({});
      expect(await result).toBe(true);
      expect(runtime.getStatus().phase).toBe("settled");
      expect(connect).toHaveBeenCalledTimes(1);
      expect(transport.requests.at(-1)).toEqual({
        requestType: "SetCurrentProgramScene",
        requestData: { sceneName: managedSceneName("scheduler-test", "main") },
      });
    } finally {
      connected.resolve(undefined);
      createdScene.resolve({});
      await runtime.dispose();
      await result;
    }
  });

  it("refuses a project ID that could escape the managed OBS namespace", () => {
    expect(() =>
      createObsTargetWithTransport(
        { projectId: "show::other", assetResolver: rejectingAssetResolver },
        new FakeObsTransport(),
      ),
    ).toThrow(/OBS project ID 'show::other' is invalid/u);
  });

  it("waits for reconvergence before selecting a scene after a connection loss", async () => {
    const project = "scheduler-test";
    const transport = new FakeObsTransport();
    enqueueConvergedObservation(transport, project);
    enqueueConvergedObservation(transport, project);
    const clock = new ManualClock();
    const target = new OBSRuntime({
      projectId: project,
      transport,
      retry: { initialDelayMs: 50, maximumDelayMs: 50, jitterRatio: 0 },
      schedulerRuntime: {
        now: () => clock.now,
        random: () => 0.5,
        setTimeout: (callback, delay) => clock.setTimeout(callback, delay),
        clearTimeout: (handle) => {
          clock.clearTimeout(handle);
        },
      },
    });
    await target.setup({
      projectId: project,
      manifest: { version: 1, assets: [] },
      extensions: [],
    });
    target.update(snapshot(1));
    await target.whenSettled(1);

    const connected = deferred<undefined>();
    const originalConnect = transport.connect.bind(transport);
    const connect = vi.spyOn(transport, "connect").mockImplementation(async (options) => {
      await connected.promise;
      return originalConnect(options);
    });
    transport.emit("ConnectionClosed", { code: 1006 });
    clock.advanceBy(50);
    await eventually(() => connect.mock.calls.length === 1);
    const selection = target.event({
      id: "select-after-reconnect",
      kind: "scene:select",
      sceneId: "main",
    });
    const result = selection.then(
      () => true,
      () => false,
    );
    try {
      await Promise.resolve();
      expect(connect).toHaveBeenCalledTimes(1);
      expect(
        transport.requests.some((request) => request.requestType === "SetCurrentProgramScene"),
      ).toBe(false);
      connected.resolve(undefined);
      expect(await result).toBe(true);
      expect(transport.connections).toHaveLength(2);
      expect(target.getStatus().phase).toBe("settled");
      expect(transport.requests.at(-1)?.requestType).toBe("SetCurrentProgramScene");
    } finally {
      connected.resolve(undefined);
      await target.dispose();
      await result;
    }
  });

  it("rejects a waiting scene selection if the target is disposed", async () => {
    const transport = new FakeObsTransport();
    enqueueEmptyObservation(transport);
    const createdScene = deferred<ObsJsonObject>();
    transport.enqueue("CreateScene", createdScene.promise);
    const target = new OBSRuntime({ projectId: "scheduler-test", transport });
    await target.setup({
      projectId: "scheduler-test",
      manifest: { version: 1, assets: [] },
      extensions: [],
    });
    target.update(snapshot(1));
    await eventually(() =>
      transport.requests.some((request) => request.requestType === "CreateScene"),
    );
    const selection = target.event({
      id: "select-before-disposal",
      kind: "scene:select",
      sceneId: "main",
    });
    const rejected = expect(selection).rejects.toThrow(/disposed/u);
    await target.dispose();
    createdScene.resolve({});
    await rejected;
    expect(
      transport.requests.some((request) => request.requestType === "SetCurrentProgramScene"),
    ).toBe(false);
  });

  it("rejects scene selection when the preceding snapshot fails preflight", async () => {
    const transport = new FakeObsTransport();
    const target = new OBSRuntime({ projectId: "another-project", transport });
    await target.setup({
      projectId: "another-project",
      manifest: { version: 1, assets: [] },
      extensions: [],
    });
    target.update(snapshot(1));
    await expect(
      target.event({ id: "select-invalid-snapshot", kind: "scene:select", sceneId: "main" }),
    ).rejects.toThrow(/Snapshot is for project/u);
    expect(transport.connections).toHaveLength(0);
    expect(transport.requests).toHaveLength(0);
    await target.dispose();
  });

  it("rejects a snapshot for another project before contacting OBS", async () => {
    const transport = new FakeObsTransport();
    const target = createObsTargetWithTransport(
      { projectId: "other-project", assetResolver: rejectingAssetResolver },
      transport,
    );

    target.publish(snapshot(1));

    await expect(target.whenSettled(1)).rejects.toThrow(
      /Snapshot is for project 'scheduler-test' but this OBS target manages project 'other-project'/u,
    );
    expect(target.getStatus().phase).toBe("error");
    expect(transport.connections).toHaveLength(0);
    await target.dispose();
  });

  it("refuses a composer stream for another project or with an unregistered extension", async () => {
    const cases = [
      {
        setup: { projectId: "someone-else", manifest: { version: 1, assets: [] }, extensions: [] },
        message:
          "Stream is for project 'someone-else' but this OBS runtime manages project 'scheduler-test' (projectId / --project); refusing to manage OBS.",
      },
      {
        setup: {
          projectId: "scheduler-test",
          manifest: { version: 1, assets: [] },
          extensions: [
            { kind: "source:moq", entrypoints: { obs: "@strangecyan/vignette-moq/obs" } },
          ],
        },
        message:
          "Stream requires source kind 'source:moq'; register @strangecyan/vignette-moq/obs.",
      },
    ] as const;

    for (const { setup, message } of cases) {
      const transport = new FakeObsTransport();
      const onError = vi.fn<(error: Error) => void>();
      const runtime = new OBSRuntime({ projectId: "scheduler-test", transport, onError });

      await runtime.setup(setup);
      runtime.update(snapshot(1));
      await runtime.event({ id: "select", kind: "scene:select", sceneId: "main" });

      expect(runtime.getStatus()).toEqual({ targetId: "obs", phase: "error", message });
      expect(onError).toHaveBeenCalledWith(new Error(message));
      await expect(runtime.whenSettled(1)).rejects.toThrow(message);
      expect(transport.connections).toHaveLength(0);
      await runtime.dispose();
    }
  });

  it("bounds pending work to the latest revision and reconverges after reconnect", async () => {
    const project = "scheduler-test";
    const transport = new FakeObsTransport();
    enqueueEmptyObservation(transport);
    enqueueMutationReceipts(transport);
    enqueueConvergedObservation(transport, project);
    enqueueConvergedObservation(transport, project);
    const clock = new ManualClock();
    const target = createObsTargetWithTransport(
      {
        id: "fake-obs",
        url: "ws://fake.invalid:4455",
        password: "SENTINEL_SECRET",
        projectId: project,
        assetResolver: rejectingAssetResolver,
        retry: { initialDelayMs: 100, maximumDelayMs: 100, jitterRatio: 0 },
      },
      transport,
      {
        now: () => clock.now,
        random: () => 0.5,
        setTimeout: (callback, delayMs) => clock.setTimeout(callback, delayMs),
        clearTimeout: (handle) => {
          clock.clearTimeout(handle);
        },
      },
    );

    for (let revision = 1; revision <= 100; revision += 1) target.publish(snapshot(revision));
    const receipt = await target.whenSettled(100);

    expect(receipt.settledRevision).toBe(100);
    expect(transport.connections).toHaveLength(1);
    expect(
      transport.requests.filter((request) => request.requestType === "CreateInput"),
    ).toHaveLength(1);
    expect(JSON.stringify(transport.connections)).not.toContain("SENTINEL_SECRET");

    transport.emit("ConnectionClosed", { code: 1006 });
    clock.advanceBy(100);
    await eventually(() => transport.connections.length === 2);
    await eventually(() => target.getStatus().phase === "settled");
    expect(target.getStatus()).toMatchObject({
      desiredRevision: 100,
      settledRevision: 100,
      observationEpoch: 2,
    });

    await target.dispose();
    expect(transport.listenerCount("ConnectionClosed")).toBe(0);
  });

  it("rejects a bad preflight revision and recovers on a later valid revision", async () => {
    const project = "scheduler-test";
    const transport = new FakeObsTransport();
    enqueueEmptyObservation(transport);
    enqueueEmptyObservation(transport);
    enqueueMutationReceipts(transport);
    enqueueConvergedObservation(transport, project);
    const target = createObsTargetWithTransport(
      {
        id: "recovering-obs",
        projectId: project,
        assetResolver: rejectingAssetResolver,
      },
      transport,
    );
    const fixtureSource1 = {
      id: "background",
      kind: "source:image",
      asset: asset("missing.png"),
      size: { width: 1920, height: 1080 },
    } satisfies ImageSource;
    const invalid: CompiledSnapshot = {
      ...snapshot(1),
      sources: [
        {
          id: "background",
          definition: fixtureSource1,
          intrinsicSize: { width: 1920, height: 1080 },
          asset: asset("missing.png"),
        },
      ],
    };

    target.publish(invalid);
    await expect(target.whenSettled(1)).rejects.toThrow(/could not be resolved/u);
    expect(target.getStatus()).toMatchObject({ phase: "error", desiredRevision: 1 });

    target.publish(snapshot(2));
    await eventually(() => target.getStatus().phase === "settled");
    await expect(target.whenSettled(2)).resolves.toMatchObject({ settledRevision: 2 });
    expect(target.getStatus()).toMatchObject({ phase: "settled", desiredRevision: 2 });
    await target.dispose();
  });

  it("pauses a partial plan across a scene collection change and reboots its epoch", async () => {
    const project = "scheduler-test";
    const transport = new FakeObsTransport();
    enqueueEmptyObservation(transport);
    let releaseFirstScene: (value: ObsJsonObject) => void = () => {
      throw new Error("Scene request has not started.");
    };
    const firstScene = new Promise<ObsJsonObject>((resolve) => {
      releaseFirstScene = resolve;
    });
    transport
      .enqueue("CreateScene", firstScene, {})
      .enqueue("CreateInput", { inputUuid: "input-background", sceneItemId: 1 })
      .enqueue("CreateSceneItem", { sceneItemId: 2 });
    enqueueRegistryOnlyObservation(transport, project);
    enqueueConvergedObservation(transport, project);
    const target = createObsTargetWithTransport(
      { id: "collection-obs", projectId: project, assetResolver: rejectingAssetResolver },
      transport,
    );

    target.publish(snapshot(1));
    await eventually(
      () =>
        transport.requests.filter((request) => request.requestType === "CreateScene").length === 1,
    );
    transport.emit("CurrentSceneCollectionChanging");
    releaseFirstScene?.({});
    await eventually(() => target.getStatus().phase === "paused");
    transport.emit("CurrentSceneCollectionChanged");
    await eventually(() => target.getStatus().phase === "settled");

    expect(target.getStatus()).toMatchObject({ settledRevision: 1, observationEpoch: 2 });
    expect(
      transport.requests.filter((request) => request.requestType === "CreateScene"),
    ).toHaveLength(2);
    await target.dispose();
  });

  it("retries NotReady without reconnecting and stops reconnecting on session invalidation", async () => {
    const project = "scheduler-test";
    const transport = new FakeObsTransport();
    enqueueEmptyObservation(transport);
    enqueueEmptyObservation(transport);
    const notReady = Object.assign(new Error("OBS is not ready"), { code: 207 });
    transport
      .enqueue("CreateScene", notReady, {}, {})
      .enqueue("CreateInput", { inputUuid: "input-background", sceneItemId: 1 })
      .enqueue("CreateSceneItem", { sceneItemId: 2 });
    enqueueConvergedObservation(transport, project);
    const clock = new ManualClock();
    const target = createObsTargetWithTransport(
      {
        id: "not-ready-obs",
        projectId: project,
        assetResolver: rejectingAssetResolver,
        retry: { initialDelayMs: 50, maximumDelayMs: 50, jitterRatio: 0 },
      },
      transport,
      {
        now: () => clock.now,
        random: () => 0.5,
        setTimeout: (callback, delayMs) => clock.setTimeout(callback, delayMs),
        clearTimeout: (handle) => {
          clock.clearTimeout(handle);
        },
      },
    );

    target.publish(snapshot(1));
    await eventually(() => target.getStatus().phase === "paused");
    clock.advanceBy(50);
    await eventually(() => target.getStatus().phase === "settled");
    expect(transport.connections).toHaveLength(1);

    transport.emit("ConnectionClosed", { code: 4011 });
    expect(target.getStatus().phase).toBe("error");
    expect(() => {
      target.publish(snapshot(2));
    }).toThrow(/terminal/u);
    clock.advanceBy(500);
    expect(transport.connections).toHaveLength(1);
    await target.dispose();
  });

  it("refreshes persisted browser inputs once per websocket session", async () => {
    const project = "scheduler-test";
    const transport = new FakeObsTransport();
    enqueueConvergedBrowserObservation(transport, project);
    enqueueConvergedBrowserObservation(transport, project);
    const clock = new ManualClock();
    const target = createObsTargetWithTransport(
      {
        id: "browser-refresh-obs",
        projectId: project,
        assetResolver: rejectingAssetResolver,
        retry: { initialDelayMs: 50, maximumDelayMs: 50, jitterRatio: 0 },
      },
      transport,
      {
        now: () => clock.now,
        random: () => 0.5,
        setTimeout: (callback, delayMs) => clock.setTimeout(callback, delayMs),
        clearTimeout: (handle) => {
          clock.clearTimeout(handle);
        },
      },
    );

    target.publish(browserSnapshot(1));
    await target.whenSettled(1);
    target.publish(browserSnapshot(2));
    await target.whenSettled(2);

    expect(refreshRequests(transport)).toEqual([
      {
        requestType: "PressInputPropertiesButton",
        requestData: {
          inputName: managedSourceName(project, "browser"),
          propertyName: "refreshnocache",
        },
      },
    ]);

    transport.emit("ConnectionClosed", { code: 1006 });
    clock.advanceBy(50);
    await eventually(() => refreshRequests(transport).length === 2);

    expect(refreshRequests(transport)).toHaveLength(2);
    await target.dispose();
  });
});

const rejectingAssetResolver: AssetResolver = {
  resolve() {
    return Promise.reject(new Error("No assets are expected in this fixture."));
  },
};

function snapshot(revision: number): CompiledSnapshot {
  const source = "background";
  const fixtureSource2 = {
    id: source,
    kind: "source:color",
    color: "#112233",
    size: { width: 1920, height: 1080 },
  } satisfies ColorSource;
  return {
    revision,
    projectId: "scheduler-test",
    canvas: { width: 1920, height: 1080 },
    warnings: [],
    sources: [
      {
        id: source,
        definition: fixtureSource2,
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
            visible: true,
            opacity: 1,
            rotation: 0,
          },
        ],
      },
    ],
  };
}

function browserSnapshot(revision: number): CompiledSnapshot {
  const source = "browser";
  const fixtureSource3 = {
    id: source,
    kind: "source:browser",
    url: "http://127.0.0.1:4173/frame",
    viewport: { width: 1280, height: 720 },
  } satisfies BrowserSource;
  return {
    revision,
    projectId: "scheduler-test",
    canvas: { width: 1920, height: 1080 },
    warnings: [],
    sources: [
      {
        id: source,
        definition: fixtureSource3,
      },
    ],
    scenes: [
      {
        id: "main",
        items: [
          {
            id: "browser-layer",
            content: { kind: "source", sourceId: source },
            frame: { x: 0, y: 0, width: 1280, height: 720 },
            visible: true,
            opacity: 1,
            rotation: 0,
          },
        ],
      },
    ],
  };
}

function enqueueEmptyObservation(transport: FakeObsTransport): void {
  transport
    .enqueue("GetVersion", versionResponse())
    .enqueue("GetInputKindList", { inputKinds: ["color_source_v3"] })
    .enqueue("GetSceneList", { scenes: [] })
    .enqueue("GetInputList", { inputs: [] });
}

function enqueueMutationReceipts(transport: FakeObsTransport): void {
  transport
    .enqueue("CreateScene", {}, {})
    .enqueue("CreateInput", { inputUuid: "input-background", sceneItemId: 1 })
    .enqueue("CreateSceneItem", { sceneItemId: 2 });
}

function enqueueRegistryOnlyObservation(transport: FakeObsTransport, project: string): void {
  transport
    .enqueue("GetVersion", versionResponse())
    .enqueue("GetInputKindList", { inputKinds: ["color_source_v3"] })
    .enqueue("GetSceneList", {
      scenes: [
        {
          sceneName: registrySceneName(project),
          sceneUuid: "scene-registry",
          sceneIndex: 0,
        },
      ],
    })
    .enqueue("GetInputList", { inputs: [] })
    .enqueue("GetSceneItemList", { sceneItems: [] });
}

function enqueueConvergedObservation(transport: FakeObsTransport, project: string): void {
  const sourceName = managedSourceName(project, "background");
  const transform = desiredTransform();
  transport
    .enqueue("GetVersion", versionResponse())
    .enqueue("GetInputKindList", { inputKinds: ["color_source_v3"] })
    .enqueue("GetSceneList", {
      scenes: [
        {
          sceneName: registrySceneName(project),
          sceneUuid: "scene-registry",
          sceneIndex: 0,
        },
        {
          sceneName: managedSceneName(project, "main"),
          sceneUuid: "scene-main",
          sceneIndex: 1,
        },
      ],
    })
    .enqueue("GetInputList", {
      inputs: [
        {
          inputName: sourceName,
          inputUuid: "input-background",
          inputKind: "color_source_v3",
        },
      ],
    })
    .enqueue("GetInputSettings", {
      inputKind: "color_source_v3",
      inputSettings: { color: 0xff332211 >>> 0, width: 1920, height: 1080 },
    })
    .enqueue(
      "GetSceneItemList",
      {
        sceneItems: [
          {
            sceneItemId: 1,
            sceneItemIndex: 0,
            sourceName,
            sourceUuid: "input-background",
            sceneItemEnabled: false,
          },
        ],
      },
      {
        sceneItems: [
          {
            sceneItemId: 2,
            sceneItemIndex: 0,
            sourceName,
            sourceUuid: "input-background",
            sceneItemEnabled: true,
            sceneItemTransform: transform,
          },
        ],
      },
    );
}

function enqueueConvergedBrowserObservation(transport: FakeObsTransport, project: string): void {
  const sourceName = managedSourceName(project, "browser");
  transport
    .enqueue("GetVersion", versionResponse())
    .enqueue("GetInputKindList", { inputKinds: ["browser_source"] })
    .enqueue("GetSceneList", {
      scenes: [
        {
          sceneName: registrySceneName(project),
          sceneUuid: "scene-registry",
          sceneIndex: 0,
        },
        {
          sceneName: managedSceneName(project, "main"),
          sceneUuid: "scene-main",
          sceneIndex: 1,
        },
      ],
    })
    .enqueue("GetInputList", {
      inputs: [
        {
          inputName: sourceName,
          inputUuid: "input-browser",
          inputKind: "browser_source",
        },
      ],
    })
    .enqueue("GetInputSettings", {
      inputKind: "browser_source",
      inputSettings: {
        url: "http://127.0.0.1:4173/frame",
        width: 1280,
        height: 720,
        css: "body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }",
        shutdown: false,
      },
    })
    .enqueue(
      "GetSceneItemList",
      {
        sceneItems: [
          {
            sceneItemId: 1,
            sceneItemIndex: 0,
            sourceName,
            sourceUuid: "input-browser",
            sceneItemEnabled: false,
          },
        ],
      },
      {
        sceneItems: [
          {
            sceneItemId: 2,
            sceneItemIndex: 0,
            sourceName,
            sourceUuid: "input-browser",
            sceneItemEnabled: true,
            sceneItemTransform: {
              ...desiredTransform(),
              boundsWidth: 1280,
              boundsHeight: 720,
            },
          },
        ],
      },
    );
}

function refreshRequests(transport: FakeObsTransport) {
  return transport.requests.filter(
    (request) => request.requestType === "PressInputPropertiesButton",
  );
}

function versionResponse() {
  return {
    obsVersion: "32.0.0",
    obsWebSocketVersion: "5.6.0",
    rpcVersion: 1,
    availableRequests: REQUIRED_OBS_REQUESTS,
    platform: "test",
  };
}

function desiredTransform() {
  return {
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
  };
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Condition did not become true.");
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Promise has not been initialized.");
  };
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
