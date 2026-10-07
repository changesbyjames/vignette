import { z } from "zod";
import { omitUndefined } from "@strangecyan/vignette-core";
import { expect, test } from "@playwright/test";
import {
  consumeRuntimeMessages,
  RuntimeMessageHub,
  type CompiledItem,
  type CompiledSnapshot,
  type CompiledSource,
  type BrowserSource,
} from "@strangecyan/vignette-core";
import {
  Broadcast,
  ColorSource,
  Layer,
  Scene,
  Sources,
  createComposerRoot,
  defineComposition,
} from "@strangecyan/vignette";
import { managedSceneName, managedSourceName, OBSRuntime } from "@strangecyan/vignette-target-obs";
import { OBSWebSocket } from "obs-websocket-js";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";
import { createElement } from "react";

import {
  comparePngBuffers,
  createComparisonStrip,
  createParityReportHtml,
  MAX_DIFFERENCE_RATIO,
} from "./parity.js";

interface IsolateFrameSnapshot {
  snapshot: CompiledSnapshot;
  source: CompiledSource;
  item: CompiledItem;
}

const enabled = process.env.VIGNETTE_ALLOW_INTEGRATION === "1";

test("embedded OBS runtime consumes the in-memory snapshot stream", async () => {
  test.skip(!enabled, "Set VIGNETTE_ALLOW_INTEGRATION=1 for a disposable local OBS instance.");
  test.setTimeout(60_000);
  const url = requiredEnvironment("VIGNETTE_OBS_URL");
  const password = requiredEnvironment("VIGNETTE_OBS_PASSWORD");
  const expectedCollection = requiredEnvironment("VIGNETTE_OBS_TEST_COLLECTION");
  const project = `integration-${String(Date.now())}`;
  const prefix = `vignette::${project}::`;
  const sceneName = managedSceneName(project, "main");

  await assertDisposableCollection(url, password, expectedCollection);

  const hub = new RuntimeMessageHub();
  hub.publish({
    kind: "setup",
    projectId: project,
    manifest: { version: 1, assets: [] },
    extensions: [],
  });
  const runtime = new OBSRuntime({ id: "integration-obs", url, password, projectId: project });
  const consuming = consumeRuntimeMessages(runtime, hub.subscribe());
  const root = createComposerRoot(
    defineComposition({
      id: project,
      canvas: { width: 1920, height: 1080, frameRate: 60 },
      component: () => show("#112233"),
    }),
  );
  const unsubscribe = root.subscribe((snapshot) => {
    hub.publish({ kind: "update", snapshot });
  });

  try {
    const first = await root.render();
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

test("View frame has pixel-aligned DOM and OBS browser viewports", async ({
  page,
  baseURL,
}, testInfo) => {
  test.skip(!enabled, "Set VIGNETTE_ALLOW_INTEGRATION=1 for a disposable local OBS instance.");
  test.setTimeout(60_000);
  const url = requiredEnvironment("VIGNETTE_OBS_URL");
  const password = requiredEnvironment("VIGNETTE_OBS_PASSWORD");
  const expectedCollection = requiredEnvironment("VIGNETTE_OBS_TEST_COLLECTION");
  const project = `frame-parity-${String(Date.now())}`;
  const prefix = `vignette::${project}::`;

  await assertDisposableCollection(url, password, expectedCollection);
  const exampleSnapshot = await readExampleSnapshot(new URL("/runtime", baseURL));
  const { snapshot, source, item } = isolateFrameSnapshot(exampleSnapshot, project);
  const width = Math.round(item.frame.width);
  const height = Math.round(item.frame.height);
  const runtime = new OBSRuntime({
    id: "frame-parity-obs",
    url,
    password,
    projectId: project,
    // The snapshot's frame URL is root-relative; OBS loads it from the Playwright web server.
    baseUrl: new URL("/", baseURL).href,
  });
  const previousProgramScene = await currentProgramScene(url, password);

  try {
    await runtime.setup({
      projectId: project,
      manifest: { version: 1, assets: [] },
      extensions: [],
    });
    runtime.update(snapshot);
    await waitForRuntime(runtime, snapshot.revision, "frame parity convergence");

    const inputName = managedSourceName(project, source.id);
    const settings = await inputSettings(url, password, inputName);
    expect(settings).toMatchObject({ width, height });
    await setProgramScene(url, password, managedSceneName(project, "main"));

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
      page.frameLocator(`iframe[data-vignette-source="${source.id}"]`).getByTestId("clock-frame"),
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
        id: "background",
        color,
        size: { width: 1920, height: 1080 },
      }),
    ),
    createElement(
      Scene,
      { id: "main" },
      createElement(Layer, {
        id: "background",
        sourceId: "background",
        style: { width: "100%", height: "100%" },
      }),
    ),
  );
}

/** Read complete SSE records until an update arrives, retaining incomplete bytes between chunks. */
async function readExampleSnapshot(url: URL): Promise<CompiledSnapshot> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 10_000);
  const response = await fetch(url, { signal: controller.signal });
  if (!response.ok || response.body === null) {
    clearTimeout(timeout);
    throw new Error(`Kitchen-sink runtime stream returned ${String(response.status)}.`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    // Read complete SSE records until an update arrives, retaining incomplete bytes between chunks.

    for (;;) {
      // Read complete SSE records until an update arrives, retaining incomplete bytes between chunks.

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
        return /* SAFETY: The update event is emitted by the Vignette runtime snapshot encoder. */ JSON.parse(
          data,
        ) as CompiledSnapshot;
      }
      if (chunk.done) throw new Error("Kitchen-sink runtime stream ended before an update.");
    }
  } finally {
    clearTimeout(timeout);
    await reader.cancel();
  }
}

/** Select the frame browser source and its placement, then build an isolated managed project for comparison. */
function isolateFrameSnapshot(
  example: CompiledSnapshot,
  project: string,
): Readonly<IsolateFrameSnapshot> {
  const source = example.sources.find(
    (candidate) =>
      candidate.definition.kind === "source:browser" &&
      /* SAFETY: This fixture or kind-selected source factory supplies the complete built-in definition inspected here. */ (
        candidate.definition as BrowserSource
      ).url.includes("/__vignette/frame/"),
  );
  if (source === undefined) throw new Error("Kitchen-sink snapshot has no <View> browser source.");
  const originalItem = example.scenes
    .flatMap((candidate) => candidate.items)
    .find(
      (candidate) =>
        candidate.content.kind === "source" && candidate.content.sourceId === source.id,
    );
  if (originalItem === undefined) throw new Error("Kitchen-sink snapshot has no <View> layer.");
  const destination = originalItem.placement?.destination ?? originalItem.frame;
  const item: CompiledItem = {
    id: "frame-view",
    content: { kind: "source", sourceId: source.id },
    frame: { x: 0, y: 0, width: destination.width, height: destination.height },
    ...omitUndefined({
      placement:
        originalItem.placement === undefined
          ? undefined
          : {
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
      scenes: [{ id: "main", items: [item] }],
      warnings: [],
    },
  };
}

async function inputSettings(
  url: string,
  password: string,
  inputName: string,
): Promise<ObsInputSettings> {
  return withClient(url, password, async (client) => {
    const response = await client.call("GetInputSettings", { inputName });
    return ObsInputSettingsSchema.parse(response.inputSettings);
  });
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
  let timeout: ReturnType<typeof setTimeout> | undefined = undefined;
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

const ObsInputSettingsSchema = z.record(z.string(), z.json());
type ObsInputSettings = z.output<typeof ObsInputSettingsSchema>;
const ObsSceneHeaderSchema = z.object({ sceneName: z.string(), sceneUuid: z.string().optional() });
type ObsSceneHeader = z.output<typeof ObsSceneHeaderSchema>;

async function sceneExists(url: string, password: string, sceneName: string): Promise<boolean> {
  return withClient(url, password, async (client) => {
    const response = await client.call("GetSceneList");
    return response.scenes.some(
      (value) => ObsSceneHeaderSchema.safeParse(value).data?.sceneName === sceneName,
    );
  });
}

async function cleanupManagedPrefix(url: string, password: string, prefix: string): Promise<void> {
  await withClient(url, password, async (client) => {
    const scenes = await client.call("GetSceneList");
    // Cleanup only successfully decoded scenes owned by this integration run's namespace.
    for (const value of scenes.scenes) {
      const parsed = ObsSceneHeaderSchema.safeParse(value);
      if (!parsed.success || !parsed.data.sceneName.startsWith(prefix)) continue;
      const scene: ObsSceneHeader = parsed.data;
      if (scene.sceneUuid === undefined) throw new Error("Managed scene has no UUID.");
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
