import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { Plugin, ViteDevServer } from "vite";
import { z } from "zod";

import { discoverFrames, generateFrameEntry } from "../bundle/bundle.js";
import { framesHtml } from "../bundle/frames-html.js";
import type { Composer } from "../compose/compose.js";
import { createDevComposer, type ComposerListener, type DevComposer } from "./dev-composer.js";
import {
  ASSETS_PATH,
  FRAMES_HTML_PATH,
  FRAMES_JS_PATH,
  PREVIEW_JS_PATH,
  previewEntry,
} from "./pages.js";
import { sendFile } from "./static-file.js";

/** Options of {@link vignette}. */
export interface VignetteOptions {
  /** The show module, relative to Vite's `root`; its default export is the `<Show>`. */
  readonly show: string;
  /** Where the stream is served; default `/stream`. */
  readonly streamPath?: string;
}

/** What the plugin exposes to code that created the dev server, as `plugin.api`. */
export interface VignettePluginApi {
  /** The dev server's current composer, once the show first loaded. */
  composer(): Composer | undefined;
  /**
   * Calls `listener` with the current composer and each one that replaces it (a changed show
   * ID, canvas or asset manifest). A replaced composer's streams end before the listener runs.
   */
  onComposer(listener: ComposerListener): () => void;
}

/** The plugin, with its {@link VignettePluginApi} always present. */
export interface VignettePlugin extends Plugin<VignettePluginApi> {
  readonly api: VignettePluginApi;
}

const FRAMES_ID = "\0vignette:frames";
const PREVIEW_ID = "\0vignette:preview";
const FRAME_FILE = /\.frame\.[jt]sx$/u;

const AddressSchema = z.object({ port: z.number() });
type Address = z.output<typeof AddressSchema>;

/**
 * Runs a show inside `vite dev`: composes it in Vite's SSR environment (recomposing on every
 * edit), serves its stream at `streamPath`, the frame page at `/vignette/frames.html` and
 * `frames.js`, the show's `assets/` at `/vignette/assets/`, and a preview module at
 * `/vignette/preview.js`. The stream's `serve` locations are the dev server's own origin, or
 * `server.origin` when set. Production builds use `bundle` instead; this plugin only serves.
 */
export function vignette(options: VignetteOptions): VignettePlugin {
  const streamPath = options.streamPath ?? "/stream";
  const listeners = new Set<ComposerListener>();
  let composer: DevComposer | undefined = undefined;
  let showPath = "";

  async function frameFiles(): Promise<string[]> {
    const root = dirname(showPath);
    return discoverFrames(root, root);
  }

  return {
    name: "vignette",
    apply: "serve",
    api: {
      composer: () => composer?.current(),
      onComposer(listener) {
        listeners.add(listener);
        const current = composer?.current();
        if (current !== undefined) listener(current);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    config: () => ({
      // Yoga embeds its wasm with top-level await, which the dependency optimizer cannot bundle.
      optimizeDeps: { exclude: ["yoga-layout"] },
      // The show, `@strangecyan/vignette` and frames must share one React.
      resolve: { dedupe: ["react", "react-dom"] },
    }),
    configResolved(config) {
      showPath = resolve(config.root, options.show);
    },
    resolveId(id) {
      const path = id.split("?", 1)[0];
      if (path === FRAMES_JS_PATH) return FRAMES_ID;
      if (path === PREVIEW_JS_PATH) return PREVIEW_ID;
      return undefined;
    },
    async load(id) {
      if (id === FRAMES_ID) return generateFrameEntry(await frameFiles());
      if (id === PREVIEW_ID) return previewEntry(streamPath);
      return undefined;
    },
    async configureServer(server) {
      const assetsDir = join(dirname(showPath), "assets");
      const dev = await createDevComposer(server, {
        show: showPath,
        streamPath,
        origin: origin(server),
      });
      composer = dev;
      dev.onComposer((next) => {
        for (const listener of [...listeners]) listener(next);
      });
      server.watcher.add(assetsDir);
      server.watcher.on("all", (event, file) => {
        if (isInside(assetsDir, file)) {
          dev.assetsChanged();
          return;
        }
        dev.fileChanged(file);
        if (event !== "change" && FRAME_FILE.test(file)) frameSetChanged(server);
      });
      server.middlewares.use((request, response, next) => {
        serve(request, response, { dev, server, assetsDir }).then((handled) => {
          if (!handled) next();
        }, next);
      });
    },
    async buildEnd() {
      await composer?.dispose();
    },
  };
}

/** What the plugin's middleware serves from. */
interface ServeContext {
  readonly dev: DevComposer;
  readonly server: ViteDevServer;
  readonly assetsDir: string;
}

/** The stream, `frames.html` and assets; everything else falls through to Vite. */
async function serve(
  request: IncomingMessage,
  response: ServerResponse,
  { dev, server, assetsDir }: ServeContext,
): Promise<boolean> {
  if (await dev.handle(request, response)) return true;
  const url = request.url ?? "/";
  const path = url.split("?", 1)[0] ?? "/";
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (path === FRAMES_HTML_PATH) {
    const html = await server.transformIndexHtml(url, framesHtml({ script: "./frames.js" }));
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
    return true;
  }
  if (path.startsWith(ASSETS_PATH)) {
    return sendFile(assetsDir, path.slice(ASSETS_PATH.length), response);
  }
  return false;
}

/** A frame module was added or removed: the generated entries import a different set. */
function frameSetChanged(server: ViteDevServer): void {
  const graph = server.environments.client.moduleGraph;
  for (const id of [FRAMES_ID, PREVIEW_ID]) {
    const module = graph.getModuleById(id);
    if (module !== undefined) graph.invalidateModule(module);
  }
  server.environments.client.hot.send({ type: "full-reload" });
}

/** `server.origin` if set, else `http://<host>:<port>` once the dev server listens. */
function origin(server: ViteDevServer): Promise<string> {
  const configured = server.config.server.origin;
  if (configured !== undefined) return Promise.resolve(configured.replace(/\/$/u, ""));
  const http = server.httpServer;
  if (http === null) {
    throw new Error("vignette(): set `server.origin` when Vite runs in middleware mode.");
  }
  const scheme = server.config.server.https === undefined ? "http" : "https";
  const host = publicHost(server.config.server.host);
  return new Promise((resolveOrigin) => {
    http.once("listening", () => {
      const { port }: Address = AddressSchema.parse(http.address());
      resolveOrigin(`${scheme}://${host}:${String(port)}`);
    });
  });
}

/** The configured host, or `localhost` when Vite listens on localhost or every interface. */
function publicHost(host: string | boolean | undefined): string {
  if (host === undefined || host === true || host === false) return "localhost";
  if (host === "" || host === "0.0.0.0" || host === "::") return "localhost";
  return host.includes(":") ? `[${host}]` : host;
}

/** `file` is `dir` or anything under it. */
function isInside(dir: string, file: string): boolean {
  const path = relative(dir, file);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}
