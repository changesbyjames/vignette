import { expect, test } from "@playwright/test";
import {
  consumeRuntimeMessages,
  layerId,
  projectId,
  RuntimeMessageHub,
  sceneId,
  sourceId,
  type CompiledItem,
  type CompiledSnapshot,
  type CompiledSource,
  type BrowserSource,
} from "@cbj/vignette-core";
import type { MoqSource } from "@cbj/vignette-moq";
import { moqObsCodec } from "@cbj/vignette-moq/obs";
import { Broadcast, ColorSource, Layer, Scene, Sources, createComposerRoot } from "@cbj/vignette";
import { managedSceneName, managedSourceName, OBSRuntime } from "@cbj/vignette-target-obs";
import { OBSWebSocket } from "obs-websocket-js";
import { mkdir, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";
import process from "node:process";
import { createElement } from "react";

import {
  comparePngBuffers,
  createComparisonStrip,
  createParityReportHtml,
  MAX_DIFFERENCE_RATIO,
} from "./parity.js";

const enabled = process.env.VIGNETTE_ALLOW_INTEGRATION === "1";

test("embedded OBS runtime consumes the in-memory snapshot stream", async () => {
  test.skip(!enabled, "Set VIGNETTE_ALLOW_INTEGRATION=1 for a disposable local OBS instance.");
  test.setTimeout(60_000);
  const url = requiredEnvironment("VIGNETTE_OBS_URL");
  const password = requiredEnvironment("VIGNETTE_OBS_PASSWORD");
  const expectedCollection = requiredEnvironment("VIGNETTE_OBS_TEST_COLLECTION");
  const project = projectId(`integration-${String(Date.now())}`);
  const prefix = `vignette::${project}::`;
  const sceneName = managedSceneName(project, sceneId("main"));

  await assertDisposableCollection(url, password, expectedCollection);

  const hub = new RuntimeMessageHub();
  hub.publish({ kind: "setup", manifest: { version: 1, assets: [] } });
  const runtime = new OBSRuntime({ id: "integration-obs", url, password, projectId: project });
  const consuming = consumeRuntimeMessages(runtime, hub.subscribe());
  const root = createComposerRoot({
    projectId: project,
    canvas: { width: 1920, height: 1080, frameRate: 60 },
  });
  const unsubscribe = root.subscribe((snapshot) => {
    hub.publish({ kind: "update", snapshot });
  });

  try {
    const first = await root.render(show("#112233"));
    await waitForRuntime(runtime, first.compiledRevision, "initial convergence");
    expect(await sceneExists(url, password, sceneName)).toBe(true);

    const second = await root.render(show("#334455"));
    await waitForRuntime(runtime, second.compiledRevision, "update convergence");
    expect(runtime.getStatus()).toMatchObject({
      phase: "settled",
      settledRevision: second.compiledRevision,
    });
  } finally {
    unsubscribe();
    hub.close();
    await consuming;
    await runtime.dispose();
    await root.dispose();
    await cleanupManagedPrefix(url, password, prefix);
  }
});

test("custom OBS MoQ source receives the same live configuration", async () => {
  test.skip(!enabled, "Set VIGNETTE_ALLOW_INTEGRATION=1 for a disposable local OBS instance.");
  test.setTimeout(60_000);
  const url = requiredEnvironment("VIGNETTE_OBS_URL");
  const password = requiredEnvironment("VIGNETTE_OBS_PASSWORD");
  const expectedCollection = requiredEnvironment("VIGNETTE_OBS_TEST_COLLECTION");
  const project = projectId(`moq-integration-${String(Date.now())}`);
  const prefix = `vignette::${project}::`;

  await assertDisposableCollection(url, password, expectedCollection);
  const studioSnapshot = await readStudioSnapshot();
  const { snapshot, source } = isolateMoqSnapshot(studioSnapshot, project);
  const runtime = new OBSRuntime({
    id: "moq-integration-obs",
    url,
    password,
    projectId: project,
    extensions: [moqObsCodec],
  });
  const previousProgramScene = await currentProgramScene(url, password);

  try {
    await runtime.setup({ version: 1, assets: [] });
    runtime.update(snapshot);
    await waitForRuntime(runtime, snapshot.revision, "MoQ convergence");

    const inputName = managedSourceName(project, source.id);
    expect(await inputKind(url, password, inputName)).toBe("moq_source");
    expect(await inputSettings(url, password, inputName)).toMatchObject({
      url: "https://cdn.moq.dev/demo",
      broadcast: "bbb.hang",
      latency_ms: 100,
      video: true,
      audio: false,
      quality: "auto",
      disable_when_hidden: false,
    });
    await setProgramScene(url, password, managedSceneName(project, sceneId("main")));

    await expect
      .poll(
        async () => {
          try {
            const [png] = await captureObsCandidates(url, password, inputName, 1);
            return png === undefined ? false : pngHasPicture(png, 1280, 720);
          } catch {
            return false;
          }
        },
        { timeout: 30_000 },
      )
      .toBe(true);
  } finally {
    await setProgramScene(url, password, previousProgramScene);
    await runtime.dispose();
    await cleanupManagedPrefix(url, password, prefix);
  }
});

test("View frame has pixel-aligned DOM and OBS browser viewports", async ({ page }, testInfo) => {
  test.skip(!enabled, "Set VIGNETTE_ALLOW_INTEGRATION=1 for a disposable local OBS instance.");
  test.setTimeout(60_000);
  const url = requiredEnvironment("VIGNETTE_OBS_URL");
  const password = requiredEnvironment("VIGNETTE_OBS_PASSWORD");
  const expectedCollection = requiredEnvironment("VIGNETTE_OBS_TEST_COLLECTION");
  const project = projectId(`frame-parity-${String(Date.now())}`);
  const prefix = `vignette::${project}::`;

  await assertDisposableCollection(url, password, expectedCollection);
  const studioSnapshot = await readStudioSnapshot();
  const { snapshot, source, item } = isolateFrameSnapshot(studioSnapshot, project);
  const width = Math.round(item.frame.width);
  const height = Math.round(item.frame.height);
  const runtime = new OBSRuntime({ id: "frame-parity-obs", url, password, projectId: project });
  const previousProgramScene = await currentProgramScene(url, password);

  try {
    await runtime.setup({ version: 1, assets: [] });
    runtime.update(snapshot);
    await waitForRuntime(runtime, snapshot.revision, "frame parity convergence");

    const inputName = managedSourceName(project, source.id);
    const settings = await inputSettings(url, password, inputName);
    expect(settings).toMatchObject({ width, height });
    await setProgramScene(url, password, managedSceneName(project, sceneId("main")));

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/?parity=frame");
    await expect(page.getByTestId("dom-status")).toHaveText("settled");
    await expect(page.locator("body")).toHaveClass(/parity-page/u);
    const frame = page.locator(`iframe[data-vignette-source="${source.id}"]`);
    await expect(frame).toHaveCount(1);
    await expect
      .poll(async () => {
        const box = await frame.boundingBox();
        return box === null ? undefined : [Math.round(box.width), Math.round(box.height)];
      })
      .toEqual([width, height]);
    await expect(
      page
        .frameLocator(`iframe[data-vignette-source="${source.id}"]`)
        .getByTestId("greeting-frame"),
    ).toHaveAttribute("data-hydrated", "true");

    const domPng = await frame.screenshot({ animations: "disabled", type: "png" });
    const obsCandidates = await captureObsCandidates(url, password, inputName, 5);
    const comparisons = obsCandidates.map((obsPng) => ({
      obsPng,
      result: comparePngBuffers(domPng, obsPng, {
        masks: [{ x: 0, y: Math.floor(height * 0.6), width, height: Math.ceil(height * 0.28) }],
      }),
    }));
    const best = comparisons.sort(
      (left, right) => left.result.differenceRatio - right.result.differenceRatio,
    )[0];
    if (best === undefined) throw new Error("OBS did not return a frame screenshot.");

    const output = testInfo.outputPath("frame-parity");
    await mkdir(output, { recursive: true });
    const strip = createComparisonStrip(domPng, best.obsPng, best.result.diffPng);
    const report = createParityReportHtml(domPng, best.obsPng, best.result);
    await Promise.all([
      writeFile(`${output}/dom.png`, domPng),
      writeFile(`${output}/obs.png`, best.obsPng),
      writeFile(`${output}/diff.png`, best.result.diffPng),
      writeFile(`${output}/side-by-side.png`, strip),
      writeFile(`${output}/index.html`, report),
    ]);
    await testInfo.attach("frame-parity-side-by-side", {
      body: strip,
      contentType: "image/png",
    });
    await testInfo.attach("frame-parity-report", {
      body: Buffer.from(report),
      contentType: "text/html",
    });
    console.info(
      `Frame parity: ${String(best.result.differingPixels)} differing pixels (${(best.result.differenceRatio * 100).toFixed(4)}%).`,
    );

    expect(best.result.differenceRatio).toBeLessThanOrEqual(MAX_DIFFERENCE_RATIO);
  } finally {
    await setProgramScene(url, password, previousProgramScene);
    await runtime.dispose();
    await cleanupManagedPrefix(url, password, prefix);
  }
});

function show(color: string) {
  return createElement(
    Broadcast,
    null,
    createElement(
      Sources,
      null,
      createElement(ColorSource, {
        id: sourceId("background"),
        color,
        size: { width: 1920, height: 1080 },
      }),
    ),
    createElement(
      Scene,
      { id: sceneId("main") },
      createElement(Layer, {
        id: layerId("background"),
        sourceId: sourceId("background"),
        style: { width: "100%", height: "100%" },
      }),
    ),
  );
}

async function readStudioSnapshot(): Promise<CompiledSnapshot> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 10_000);
  const response = await fetch("http://127.0.0.1:4173/runtime", { signal: controller.signal });
  if (!response.ok || response.body === null) {
    clearTimeout(timeout);
    throw new Error(`Studio runtime stream returned ${String(response.status)}.`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      buffered += decoder.decode(chunk.value, { stream: !chunk.done });
      const blocks = buffered.split("\n\n");
      buffered = blocks.pop() ?? "";
      for (const block of blocks) {
        const lines = block.split("\n");
        if (
          lines
            .find((line) => line.startsWith("event:"))
            ?.slice(6)
            .trim() !== "update"
        ) {
          continue;
        }
        const data = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        return JSON.parse(data) as CompiledSnapshot;
      }
      if (chunk.done) throw new Error("Studio runtime stream ended before an update.");
    }
  } finally {
    clearTimeout(timeout);
    await reader.cancel();
  }
}

function isolateFrameSnapshot(
  studio: CompiledSnapshot,
  project: ReturnType<typeof projectId>,
): Readonly<{
  snapshot: CompiledSnapshot;
  source: CompiledSource;
  item: CompiledItem;
}> {
  const source = studio.sources.find(
    (candidate) =>
      candidate.definition.kind === "source:browser" &&
      (candidate.definition as BrowserSource).url.includes("/__vignette/frame/"),
  );
  if (source === undefined) throw new Error("Studio snapshot has no <View> browser source.");
  const originalItem = studio.scenes
    .flatMap((candidate) => candidate.items)
    .find(
      (candidate) =>
        candidate.content.kind === "source" && candidate.content.sourceId === source.id,
    );
  if (originalItem === undefined) throw new Error("Studio snapshot has no <View> layer.");
  const destination = originalItem.placement?.destination ?? originalItem.frame;
  const item: CompiledItem = {
    id: layerId("frame-view"),
    content: { kind: "source", sourceId: source.id },
    frame: { x: 0, y: 0, width: destination.width, height: destination.height },
    ...(originalItem.placement === undefined
      ? {}
      : {
          placement: {
            ...originalItem.placement,
            destination: { x: 0, y: 0, width: destination.width, height: destination.height },
          },
        }),
    visible: true,
    opacity: 1,
    rotation: 0,
  };
  return {
    source,
    item,
    snapshot: {
      revision: 1,
      projectId: project,
      canvas: { width: destination.width, height: destination.height, frameRate: 60 },
      sources: [source],
      scenes: [{ id: sceneId("main"), items: [item] }],
      warnings: [],
    },
  };
}

function isolateMoqSnapshot(
  studio: CompiledSnapshot,
  project: ReturnType<typeof projectId>,
): Readonly<{ snapshot: CompiledSnapshot; source: CompiledSource }> {
  const source = studio.sources.find(
    (candidate): candidate is CompiledSource & { readonly definition: MoqSource } =>
      candidate.definition.kind === "source:moq",
  );
  if (source === undefined) {
    throw new Error("Studio snapshot has no MoQ source.");
  }
  const item: CompiledItem = {
    id: layerId("moq-view"),
    content: { kind: "source", sourceId: source.id },
    frame: {
      x: 0,
      y: 0,
      width: source.definition.size.width,
      height: source.definition.size.height,
    },
    visible: true,
    opacity: 1,
    rotation: 0,
  };
  return {
    source,
    snapshot: {
      revision: 1,
      projectId: project,
      canvas: { ...source.definition.size, frameRate: 60 },
      sources: [source],
      scenes: [{ id: sceneId("main"), items: [item] }],
      warnings: [],
    },
  };
}

async function inputSettings(
  url: string,
  password: string,
  inputName: string,
): Promise<Record<string, unknown>> {
  return withClient(url, password, async (client) => {
    const response = await client.call("GetInputSettings", { inputName });
    return response.inputSettings;
  });
}

async function inputKind(url: string, password: string, inputName: string): Promise<string> {
  return withClient(url, password, async (client) => {
    const response = await client.call("GetInputSettings", { inputName });
    return response.inputKind;
  });
}

function pngHasPicture(buffer: Buffer, width: number, height: number): boolean {
  const image = PNG.sync.read(buffer);
  if (image.width !== width || image.height !== height) return false;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (
      image.data[offset + 3] !== 0 &&
      ((image.data[offset] ?? 0) > 16 ||
        (image.data[offset + 1] ?? 0) > 16 ||
        (image.data[offset + 2] ?? 0) > 16)
    ) {
      return true;
    }
  }
  return false;
}

async function currentProgramScene(url: string, password: string): Promise<string> {
  return withClient(url, password, async (client) => {
    const response = await client.call("GetCurrentProgramScene");
    return response.currentProgramSceneName;
  });
}

async function setProgramScene(url: string, password: string, sceneName: string): Promise<void> {
  await withClient(url, password, async (client) => {
    await client.call("SetCurrentProgramScene", { sceneName });
  });
}

async function captureObsCandidates(
  url: string,
  password: string,
  sourceName: string,
  count: number,
): Promise<readonly Buffer[]> {
  return withClient(url, password, async (client) => {
    const results: Buffer[] = [];
    for (let index = 0; index < count; index += 1) {
      const response = await client.call("GetSourceScreenshot", {
        sourceName,
        imageFormat: "png",
        imageCompressionQuality: 100,
      });
      results.push(
        Buffer.from(response.imageData.replace(/^data:image\/png;base64,/u, ""), "base64"),
      );
      if (index + 1 < count) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 250);
        });
      }
    }
    return results;
  });
}

async function waitForRuntime(runtime: OBSRuntime, revision: number, label: string): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      runtime.whenSettled(revision),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(
            new Error(
              `Timed out during ${label} at revision ${String(revision)}: ${JSON.stringify(runtime.getStatus())}`,
            ),
          );
        }, 15_000);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function assertDisposableCollection(
  url: string,
  password: string,
  expectedCollection: string,
): Promise<void> {
  await withClient(url, password, async (client) => {
    const response = await client.call("GetSceneCollectionList");
    expect(response.currentSceneCollectionName).toBe(expectedCollection);
  });
}

async function sceneExists(url: string, password: string, sceneName: string): Promise<boolean> {
  return withClient(url, password, async (client) => {
    const response = await client.call("GetSceneList");
    return response.scenes.some(
      (value) => (value as { readonly sceneName?: unknown }).sceneName === sceneName,
    );
  });
}

async function cleanupManagedPrefix(url: string, password: string, prefix: string): Promise<void> {
  await withClient(url, password, async (client) => {
    const scenes = await client.call("GetSceneList");
    for (const value of scenes.scenes) {
      const scene = value as { readonly sceneName?: unknown; readonly sceneUuid?: unknown };
      if (typeof scene.sceneName !== "string" || !scene.sceneName.startsWith(prefix)) continue;
      if (typeof scene.sceneUuid !== "string") throw new Error("Managed scene has no UUID.");
      await client.call("RemoveScene", { sceneUuid: scene.sceneUuid });
    }
  });
}

async function withClient<T>(
  url: string,
  password: string,
  action: (client: OBSWebSocket) => Promise<T>,
): Promise<T> {
  const client = new OBSWebSocket();
  try {
    await client.connect(url, password, { rpcVersion: 1 });
    return await action(client);
  } finally {
    try {
      await client.disconnect();
    } catch {
      // A failed preflight may leave no socket to close.
    }
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`Missing required ${name}.`);
  return value;
}
