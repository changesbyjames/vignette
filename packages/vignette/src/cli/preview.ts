import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type * as Playwright from "playwright";

import { loadVite } from "../bundle/load-vite.js";
import type { Snapshot, SnapshotScene } from "../core/snapshot.js";
import { fromSse } from "../stream/sse.js";
import { previewEntry, previewHtml } from "../vite/pages.js";

/** Options of {@link runPreview}. */
export interface RunPreviewOptions {
  /** The stream's server-sent events URL. */
  readonly stream: string;
  /** Scene to render; default the snapshot's active scene, then its first. */
  readonly scene?: string;
  /** PNG path, or the output directory with `allScenes`. */
  readonly out?: string;
  readonly allScenes: boolean;
  readonly timeoutMs: number;
}

/** Served on the stream's own origin by request interception, so the page needs no CORS. */
const PAGE_PATH = "/__vignette-preview/";
/** The shared preview page, transparent so the screenshot keeps the show's alpha. */
const PAGE_HTML = previewHtml(`${PAGE_PATH}preview.js`, "transparent");
const ENTRY_ID = "\0vignette-preview-entry";
const INSTALL_HINT =
  "vignette preview needs Playwright with Chromium: pnpm add -D playwright && pnpm exec playwright install chromium";

/**
 * `vignette preview <stream-url>`: renders scenes of a running stream to PNG. Reads the first
 * snapshot for the canvas and scene list, then opens the preview page (`@strangecyan/vignette/react`'s
 * `<Stream url><Stage scene /></Stream>`, as `vignette dev` serves it) in headless Chromium at
 * canvas size, waits until the stream is settled, its assets are loaded and its frame pages have
 * rendered, and screenshots the stage with a transparent background.
 */
export async function runPreview(options: RunPreviewOptions): Promise<void> {
  const snapshot = await firstSnapshot(options.stream, options.timeoutMs);
  const scenes = selectScenes(snapshot, options.scene, options.allScenes);
  const paths = outputPaths(snapshot, scenes, options);
  const { chromium } = await importPlaywright();
  const script = await buildPreviewScript(options.stream);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: {
        width: Math.ceil(snapshot.canvas.width),
        height: Math.ceil(snapshot.canvas.height),
      },
    });
    page.setDefaultTimeout(options.timeoutMs);
    const base = new URL(PAGE_PATH, options.stream);
    await page.route(
      (url) => url.origin === base.origin && url.pathname.startsWith(PAGE_PATH),
      async (route) => {
        const isScript = new URL(route.request().url()).pathname.endsWith("/preview.js");
        await route.fulfill(
          isScript
            ? { contentType: "text/javascript; charset=utf-8", body: script }
            : { contentType: "text/html; charset=utf-8", body: PAGE_HTML },
        );
      },
    );
    for (const [index, scene] of scenes.entries()) {
      // One navigation per scene: a fresh `<Stream>` settles the scene from the latest snapshot.
      const path = paths[index] ?? "";
      const url = new URL(base);
      url.searchParams.set("scene", scene.id);
      await page.goto(url.href, { waitUntil: "load" });
      await waitUntilReady(page);
      await mkdir(dirname(path), { recursive: true });
      await page
        .locator("[data-vignette-stage]")
        .screenshot({ path, animations: "disabled", omitBackground: true });
      process.stdout.write(`${path}  ${scene.id} r${String(snapshot.revision)}\n`);
    }
  } finally {
    await browser.close();
  }
}

/** Reads the stream until its first update, within `timeoutMs`. */
async function firstSnapshot(stream: string, timeoutMs: number): Promise<Snapshot> {
  const done = new AbortController();
  const signal = AbortSignal.any([done.signal, AbortSignal.timeout(timeoutMs)]);
  try {
    for await (const message of fromSse(stream, { signal })) {
      if (message.kind === "update") return message.snapshot;
    }
  } finally {
    done.abort();
  }
  throw new Error(`No snapshot from ${stream} within ${String(timeoutMs)} ms.`);
}

/**
 * Every scene with `allScenes`; otherwise the named scene, else the active one, else the first.
 * A name the snapshot lacks is an error listing the scenes it has.
 */
function selectScenes(
  snapshot: Snapshot,
  selector: string | undefined,
  allScenes: boolean,
): readonly SnapshotScene[] {
  if (allScenes) return snapshot.scenes;
  const id = selector ?? snapshot.activeScene ?? snapshot.scenes[0]?.id;
  const scene = snapshot.scenes.find((candidate) => candidate.id === id);
  if (scene !== undefined) return [scene];
  if (id === undefined) throw new Error(`Show '${snapshot.id}' has no scenes to preview.`);
  const known = snapshot.scenes.map((candidate) => candidate.id).join(", ");
  throw new Error(`Scene '${id}' is not in show '${snapshot.id}' (scenes: ${known}).`);
}

/** `--out` for one scene; otherwise `<show>-<scene>.png` in `--out` or the working directory. */
function outputPaths(
  snapshot: Snapshot,
  scenes: readonly SnapshotScene[],
  options: RunPreviewOptions,
): readonly string[] {
  if (!options.allScenes && options.out !== undefined) return [resolve(options.out)];
  const directory = resolve(options.allScenes ? (options.out ?? ".") : ".");
  return scenes.map((scene) => join(directory, `${snapshot.id}-${scene.id}.png`));
}

async function importPlaywright(): Promise<typeof Playwright> {
  try {
    return await import("playwright");
  } catch (cause) {
    throw new Error(INSTALL_HINT, { cause });
  }
}

/**
 * Waits for the page's ready marker (or its error), then for child frames to load and frame pages
 * (documents with a `#frame` root) to render, fonts, decoded images and videos with a current
 * frame, then two animation frames so the last paint is on screen.
 */
async function waitUntilReady(page: Playwright.Page): Promise<void> {
  await page.waitForSelector(
    "body[data-vignette-preview='ready'], body[data-vignette-preview-error]",
    { state: "attached" },
  );
  const error = await page.evaluate(() => document.body.dataset.vignettePreviewError);
  if (error !== undefined) throw new Error(`Preview failed: ${error}`);
  await Promise.all(page.frames().map((frame) => frame.waitForLoadState("load")));
  await Promise.all(
    page
      .frames()
      .map(async (frame) =>
        frame.waitForFunction(() => (document.getElementById("frame")?.childElementCount ?? 1) > 0),
      ),
  );
  await page.evaluate(async () => {
    // Runs in the page: a video counts as loaded once it has its current frame (readyState 2).
    const stage = document.querySelector("[data-vignette-stage]");
    const images = [...(stage?.querySelectorAll("img") ?? [])];
    const videos = [...(stage?.querySelectorAll("video") ?? [])];
    await Promise.all([
      document.fonts.ready,
      ...images.map(async (image) => image.decode().catch(() => undefined)),
      ...videos.map(
        async (video) =>
          new Promise((resolveVideo) => {
            if (video.readyState >= 2) resolveVideo(undefined);
            else video.addEventListener("loadeddata", resolveVideo, { once: true });
          }),
      ),
    ]);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
}

/**
 * Compiles the preview page following `stream` with Vite: React DOM, TanStack Query and the built
 * `@strangecyan/vignette/react`, resolved from this package's directory so it works from an installed package.
 */
async function buildPreviewScript(stream: string): Promise<string> {
  const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
  const entry = previewEntry(stream);
  const outDir = await mkdtemp(join(tmpdir(), "vignette-preview-"));
  try {
    const { build } = await loadVite();
    await build({
      root: packageRoot,
      configFile: false,
      envDir: false,
      publicDir: false,
      logLevel: "warn",
      mode: "production",
      define: { "process.env.NODE_ENV": '"production"' },
      resolve: { dedupe: ["react", "react-dom"] },
      plugins: [
        {
          name: "vignette:preview-entry",
          resolveId: (id) => (id === ENTRY_ID ? ENTRY_ID : undefined),
          load: (id) => (id === ENTRY_ID ? entry : undefined),
        },
      ],
      build: {
        outDir,
        emptyOutDir: false,
        copyPublicDir: false,
        modulePreload: false,
        rolldownOptions: {
          input: ENTRY_ID,
          output: { format: "es", entryFileNames: "preview.js", codeSplitting: false },
        },
      },
    });
    return await readFile(join(outDir, "preview.js"), "utf8");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}
