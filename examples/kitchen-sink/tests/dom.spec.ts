import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { PNG } from "pngjs";
import type { BrowserSource, CompiledScene } from "@strangecyan/vignette-core";
import type { DOMRuntime } from "@strangecyan/vignette-target-dom";
import type * as DOMModule from "@strangecyan/vignette-target-dom";

declare global {
  interface Window {
    continuityRuntime: DOMRuntime;
  }
}

const executeFile = promisify(execFile);

test("receives the kitchen-sink snapshot over SSE", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("dom-status")).toHaveText("settled");
  await expect(page.locator("[data-vignette-stage]")).toHaveAttribute(
    "data-vignette-project",
    "kitchen-sink",
  );
  await expect(page.locator("[data-vignette-layer]")).toHaveCount(12);
  await expect(page.locator('iframe[src*="/__vignette/frame/"]')).toHaveCount(4);
});

test("serves parameterized frames and configures the public MoQ demo", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("dom-status")).toHaveText("settled");
  await expect(page.locator('iframe[data-vignette-source^="card."]')).toHaveCount(3);
  const firstLabel = page.frameLocator('iframe[data-vignette-source="card.layout.label.source"]');
  await expect(firstLabel.getByTestId("label-frame")).toContainText("Yoga boxes");

  const moq = page.locator('moq-watch[data-vignette-source="demo.moq"]');
  await expect(moq).toHaveCount(1);
  await expect(moq).toHaveAttribute("url", "https://cdn.moq.dev/demo");
  await expect(moq).toHaveAttribute("name", "bbb.hang");
  await expect(moq).toHaveAttribute("data-vignette-moq-quality", "auto");
});

test("hydrates the clock as an independent React root", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByTestId("dom-status")).toHaveText("settled");

  const clock = page.locator('iframe[data-vignette-source="clock.source"]');
  const sourceUrl = await clock.getAttribute("src");
  expect(sourceUrl).not.toBeNull();
  const response = await request.get(sourceUrl ?? "");
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain("Vignette kitchen sink");

  const clockFrame = page.frameLocator('iframe[data-vignette-source="clock.source"]');
  await expect(clockFrame.getByTestId("clock-frame")).toHaveAttribute("data-hydrated", "true");
  const firstTime = await clockFrame.getByTestId("clock-frame").textContent();
  await expect
    .poll(async () => clockFrame.getByTestId("clock-frame").textContent())
    .not.toBe(firstTime);
});

test("keeps the hydrated browser document across scenes without moveBefore", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Element.prototype, "moveBefore", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto("/");
  await expect(page.getByTestId("dom-status")).toHaveText("settled");
  const frameUrl = await page
    .locator('iframe[data-vignette-source="clock.source"]')
    .getAttribute("src");
  if (frameUrl === null) throw new Error("Clock frame URL is missing.");
  await page.evaluate(
    async ({ moduleUrl, frameUrl }) => {
      const loaded: unknown = await import(moduleUrl);
      // SAFETY: moduleUrl points to this repository's built DOM runtime entry.
      const { DOMRuntime } = loaded as typeof DOMModule;
      const container = document.createElement("div");
      container.dataset.testid = "continuity-stage";
      document.body.append(container);
      const runtime = new DOMRuntime({ container, sceneId: "first", baseUrl: location.href });
      await runtime.setup({
        projectId: "continuity",
        manifest: { version: 1, assets: [] },
        extensions: [],
      });
      const viewport = { width: 640, height: 240 };
      const browser: BrowserSource = {
        id: "shared-clock",
        kind: "source:browser",
        url: frameUrl,
        viewport,
      };
      const makeScene = (id: string): CompiledScene => ({
        id,
        items: [
          {
            id: `${id}.clock`,
            content: { kind: "source", sourceId: "shared-clock" },
            frame: { x: 0, y: 0, ...viewport },
            opacity: 1,
            rotation: 0,
            visible: true,
          },
        ],
      });
      runtime.update({
        projectId: "continuity",
        revision: 1,
        canvas: viewport,
        sources: [
          {
            id: "shared-clock",
            intrinsicSize: viewport,
            definition: browser,
          },
        ],
        scenes: [makeScene("first"), makeScene("second")],
        warnings: [],
      });
      await runtime.whenSettled(1);
      Object.assign(window, { continuityRuntime: runtime });
    },
    { moduleUrl: `/@fs/${resolve("packages/target-dom/dist/index.js")}`, frameUrl },
  );
  const frame = page.frameLocator('[data-testid="continuity-stage"] iframe');
  await expect(frame.getByTestId("clock-frame")).toHaveAttribute("data-hydrated", "true");
  const source = page.locator('[data-testid="continuity-stage"] iframe');
  await source.evaluate((element) => {
    if (!(element instanceof HTMLIFrameElement)) throw new Error("Expected a frame element.");
    const document = element.contentDocument;
    if (document === null) throw new Error("Clock document is missing.");
    document.documentElement.dataset.continuityMarker = "same-document";
  });
  let frameRequests = 0;
  page.on("request", (request) => {
    if (request.url() === frameUrl) frameRequests += 1;
  });
  for (const sceneId of ["second", "first", "second"]) {
    await page.evaluate(async (sceneId) => {
      await window.continuityRuntime.event({
        id: `select-${sceneId}`,
        kind: "scene:select",
        sceneId,
      });
    }, sceneId);
    await expect(
      page.locator(`[data-testid="continuity-stage"] [data-vignette-layer="${sceneId}.clock"]`),
    ).toBeVisible();
    expect(
      await source.evaluate((element) => {
        if (!(element instanceof HTMLIFrameElement)) throw new Error("Expected a frame element.");
        return element.contentDocument?.documentElement.dataset.continuityMarker;
      }),
    ).toBe("same-document");
    await expect(frame.getByTestId("clock-frame")).toHaveAttribute("data-hydrated", "true");
  }
  expect(frameRequests).toBe(0);
  await page.evaluate(async () => {
    await window.continuityRuntime.dispose();
  });
});

test("publishes dynamic layer updates from the Node composer", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("dom-status")).toHaveText("settled");
  const revision = page.getByTestId("commit-status");
  const initial = Number(await revision.textContent());
  await expect
    .poll(async () => Number(await revision.textContent()), { timeout: 5000 })
    .toBeGreaterThan(initial);
});

test("captures an exact-canvas static CLI preview", async ({ baseURL }) => {
  test.setTimeout(30_000);
  const directory = await mkdtemp(join(tmpdir(), "vignette-preview-e2e-"));
  const output = join(directory, "kitchen-sink.png");
  try {
    const { stdout } = await executeFile(
      process.execPath,
      [
        resolve("packages/cli/bin/vignette.js"),
        "preview",
        "--snapshot",
        new URL("/stream", baseURL).href,
        "--scene",
        "main",
        "--out",
        output,
      ],
      { timeout: 25_000 },
    );
    const image = PNG.sync.read(await readFile(output));
    expect(image.width).toBe(1920);
    expect(image.height).toBe(1080);
    expect(stdout).toContain("placeholders");
  } finally {
    await rm(directory, { recursive: true });
  }
});
