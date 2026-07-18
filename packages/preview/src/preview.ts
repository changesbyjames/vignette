import type { CompiledScene } from "@strangecyan/vignette-core";
import { chromium, type Browser } from "playwright";
import { mkdir, readFile, stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSnapshot } from "./load-snapshot.js";
import type {
  BrowserPreviewInput,
  BrowserPreviewResult,
  LoadedSnapshot,
  PreviewOptions,
  PreviewResult,
} from "./types.js";

/** Render the selected scenes from a compiled snapshot to PNG files. */
export async function createPreviews(options: PreviewOptions): Promise<readonly PreviewResult[]> {
  const loaded = await loadSnapshot(options.snapshot, options.timeoutMs);
  const scenes = selectScenes(loaded.snapshot.scenes, options.scene, options.allScenes);
  const paths = outputPaths(options, loaded, scenes);
  const server = await startPreviewServer(loaded.localAssetRoot);
  let browser: Browser | undefined;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      deviceScaleFactor: 1,
      viewport: {
        width: Math.ceil(loaded.snapshot.canvas.width),
        height: Math.ceil(loaded.snapshot.canvas.height),
      },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(options.timeoutMs);
    await page.goto(server.origin, { waitUntil: "load", timeout: options.timeoutMs });
    await page.waitForFunction("typeof globalThis.__vignettePreviewRender === 'function'");
    const results: PreviewResult[] = [];

    for (let index = 0; index < scenes.length; index += 1) {
      const scene = scenes[index];
      const outputPath = paths[index];
      if (scene === undefined || outputPath === undefined) continue;
      await mkdir(dirname(outputPath), { recursive: true });
      const input: BrowserPreviewInput = {
        snapshot: loaded.snapshot,
        sceneId: scene.id,
        assetUrls: browserAssetUrls(loaded, server.origin),
        ...(loaded.localAssetRoot === undefined && loaded.assetBaseUrl === undefined
          ? {}
          : { assetBaseUrl: loaded.assetBaseUrl ?? `${server.origin}assets/` }),
      };
      const rendered = await page.evaluate<BrowserPreviewResult, BrowserPreviewInput>(
        async (previewInput) => {
          const render = globalThis.__vignettePreviewRender;
          if (render === undefined) throw new Error("Preview browser entry did not initialize.");
          return render(previewInput);
        },
        input,
      );
      await page.locator("[data-vignette-stage]").screenshot({
        path: outputPath,
        animations: "disabled",
        omitBackground: true,
        timeout: options.timeoutMs,
      });
      results.push({
        sceneId: scene.id,
        revision: loaded.snapshot.revision,
        path: outputPath,
        placeholderCount: rendered.placeholderCount,
      });
    }
    await context.close();
    return results;
  } finally {
    await browser?.close();
    await server.close();
  }
}

function browserAssetUrls(
  loaded: LoadedSnapshot,
  previewOrigin: string,
): Readonly<Record<string, string>> {
  const assetRoot = loaded.localAssetRoot;
  if (assetRoot === undefined) return loaded.assetUrls;
  return Object.fromEntries(
    Object.entries(loaded.assetUrls).map(([name, url]) => {
      if (!url.startsWith("file:")) return [name, url];
      const location = relative(assetRoot, fileURLToPath(url));
      if (location === ".." || location.startsWith(`..${sep}`) || isAbsolute(location)) {
        throw new Error(`Local manifest asset '${name}' is outside the snapshot directory.`);
      }
      const route = location.split(sep).map(encodeURIComponent).join("/");
      return [name, new URL(`assets/${route}`, previewOrigin).href];
    }),
  );
}

interface PreviewServer {
  readonly origin: string;
  close(): Promise<void>;
}

async function startPreviewServer(localAssetRoot: string | undefined): Promise<PreviewServer> {
  const previewRoot = dirname(fileURLToPath(import.meta.url));
  const coreRoot = dirname(fileURLToPath(import.meta.resolve("@strangecyan/vignette-core")));
  const targetDomRoot = dirname(
    fileURLToPath(import.meta.resolve("@strangecyan/vignette-target-dom")),
  );
  const server = createServer((request, response) => {
    void handleRequest(
      request.url ?? "/",
      response,
      previewRoot,
      coreRoot,
      targetDomRoot,
      localAssetRoot,
    ).catch((cause: unknown) => {
      response.statusCode = 500;
      response.end(cause instanceof Error ? cause.message : "Preview server failed.");
    });
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolvePromise();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Preview server did not bind.");
  return {
    origin: `http://127.0.0.1:${String(address.port)}/`,
    close: () =>
      new Promise<void>((resolvePromise, reject) => {
        server.close((error) => {
          if (error === undefined) resolvePromise();
          else reject(error);
        });
      }),
  };
}

async function handleRequest(
  rawUrl: string,
  response: ServerResponse,
  previewRoot: string,
  coreRoot: string,
  targetDomRoot: string,
  localAssetRoot: string | undefined,
): Promise<void> {
  const pathname = new URL(rawUrl, "http://preview.invalid").pathname;
  if (pathname === "/") {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(previewHtml());
    return;
  }
  if (pathname.startsWith("/modules/preview/")) {
    await serveFile(previewRoot, pathname.slice("/modules/preview/".length), response);
    return;
  }
  if (pathname.startsWith("/modules/core/")) {
    await serveFile(coreRoot, pathname.slice("/modules/core/".length), response);
    return;
  }
  if (pathname.startsWith("/modules/target-dom/")) {
    await serveFile(targetDomRoot, pathname.slice("/modules/target-dom/".length), response);
    return;
  }
  if (pathname.startsWith("/assets/") && localAssetRoot !== undefined) {
    await serveFile(
      localAssetRoot,
      decodeURIComponent(pathname.slice("/assets/".length)),
      response,
    );
    return;
  }
  response.statusCode = 404;
  response.end("Not found");
}

async function serveFile(
  root: string,
  requestedPath: string,
  response: ServerResponse,
): Promise<void> {
  const path = resolve(root, requestedPath);
  const location = relative(root, path);
  if (location.startsWith(`..${sep}`) || location === ".." || isAbsolute(location)) {
    response.statusCode = 403;
    response.end("Forbidden");
    return;
  }
  const info = await stat(path).catch(() => undefined);
  if (info?.isFile() !== true) {
    response.statusCode = 404;
    response.end("Not found");
    return;
  }
  response.setHeader("content-type", contentType(path));
  response.end(await readFile(path));
}

function previewHtml(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>html, body, #preview { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }</style>
    <script type="importmap">{"imports":{"@strangecyan/vignette-core":"/modules/core/index.js","@strangecyan/vignette-target-dom":"/modules/target-dom/index.js"}}</script>
    <script type="module" src="/modules/preview/browser.js"></script>
  </head>
  <body><main id="preview"></main></body>
</html>`;
}

function contentType(path: string): string {
  switch (extname(path)) {
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function selectScenes(
  scenes: readonly CompiledScene[],
  selector: string | undefined,
  allScenes: boolean,
): readonly CompiledScene[] {
  const [firstScene] = scenes;
  if (firstScene === undefined) throw new Error("Snapshot has no scenes to preview.");
  if (allScenes) return scenes;
  if (selector === undefined) return [firstScene];
  const byId = scenes.find((scene) => scene.id === selector);
  if (byId !== undefined) return [byId];
  const byLabel = scenes.filter((scene) => scene.label === selector);
  if (byLabel.length === 1) return byLabel;
  if (byLabel.length > 1)
    throw new Error(`Scene label '${selector}' is ambiguous; use a scene id.`);
  throw new Error(`Scene '${selector}' is not present in the snapshot.`);
}

function outputPaths(
  options: PreviewOptions,
  loaded: LoadedSnapshot,
  scenes: readonly CompiledScene[],
): readonly string[] {
  const baseName = safeName(
    options.name ?? `${loaded.snapshot.projectId}-r${String(loaded.snapshot.revision)}`,
  );
  if (!options.allScenes) {
    const scene = scenes[0];
    if (scene === undefined) return [];
    return [
      resolve(
        options.out ??
          `vignette-preview/${options.name === undefined ? `${baseName}-${safeName(scene.id)}` : baseName}.png`,
      ),
    ];
  }
  const directory = resolve(options.out ?? "vignette-preview");
  return scenes.map((scene) => resolve(directory, `${baseName}-${safeName(scene.id)}.png`));
}

function safeName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
  return normalized.length === 0 ? "preview" : normalized;
}
