import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, sep } from "node:path";

import {
  createElement,
  isValidElement,
  useSyncExternalStore,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import type { ViteDevServer } from "vite";
import type { EvaluatedModuleNode, ModuleRunner } from "vite/module-runner";
import { z } from "zod";

import { loadVite } from "../bundle/load-vite.js";
import { createAssetManifest, scanAssets } from "../bundle/scan-assets.js";
import { compose, type Composer } from "../compose/compose.js";
import type { AssetManifest } from "../core/assets.js";
import { streamOptions } from "../stream/source-stream.js";
import { encodeStreamMessageSse } from "../stream/sse-codec.js";
import { ASSETS_PATH, FRAMES_HTML_PATH } from "./pages.js";

/** What a show module default-exports: the `<Show>` element, or a component rendering one. */
type ShowExport = ReactElement | ComponentType;

const ShowModuleSchema = z.object(
  {
    default: z.custom<ShowExport>((value) => isValidElement(value) || value instanceof Function, {
      error: "The default export must be a <Show> element or a component that renders one.",
    }),
  },
  { error: "The show module has no default export." },
);
type ShowModule = z.output<typeof ShowModuleSchema>;

/** Settings of {@link createDevComposer}. */
export interface DevComposerSettings {
  /** Absolute path of the show module. */
  readonly show: string;
  readonly streamPath: string;
  /** The dev server's origin (`http://host:port`), known once it listens. */
  readonly origin: Promise<string>;
}

/** Receives each composer the dev server starts. */
export type ComposerListener = (composer: Composer) => void;

/** A dev-server composer that recomposes its show when the module graph or assets change. */
export interface DevComposer {
  /** Serves the stream over SSE; resolves false for requests it does not own. */
  handle(request: IncomingMessage, response: ServerResponse): Promise<boolean>;
  /** Reloads when `file` belongs to the show's evaluated module graph. */
  fileChanged(file: string): void;
  /** Rescans `assets/`; a new manifest replaces the composer. */
  assetsChanged(): void;
  /** The current composer, once the show first loaded. */
  current(): Composer | undefined;
  /**
   * Calls `listener` with the current composer and every one that replaces it. A replaced
   * composer is disposed first, which ends its streams.
   */
  onComposer(listener: ComposerListener): () => void;
  dispose(): Promise<void>;
}

/** Holds the latest show export; the composer's root component renders whatever it holds. */
interface ShowStore {
  readonly get: () => ShowExport;
  readonly set: (show: ShowExport) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

/** Props of {@link DevShow}. */
interface DevShowProps {
  readonly store: ShowStore;
}

interface ActiveComposer {
  readonly composer: Composer;
  readonly store: ShowStore;
  readonly manifest: AssetManifest;
  /** Aborts every stream served from this composer when it is replaced. */
  readonly abort: AbortController;
}

/** Starts composing `settings.show` in the dev server's SSR environment. */
export async function createDevComposer(
  server: ViteDevServer,
  settings: DevComposerSettings,
): Promise<DevComposer> {
  const { createServerModuleRunner } = await loadVite();
  // A dedicated runner without HMR keeps evaluated modules until this composer invalidates them.
  const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });
  return new DevComposerImpl(server, runner, settings);
}

/**
 * One composer lives as long as the show's ID, canvas and asset manifest stay the same: a reload
 * hands the new export to its root, so revisions continue and connected targets converge without
 * reconnecting. Anything else replaces the composer, and its streams end so clients reconnect
 * for the new setup.
 */
class DevComposerImpl implements DevComposer {
  private readonly server: ViteDevServer;
  private readonly settings: DevComposerSettings;
  private readonly runner: ModuleRunner;
  private readonly listeners = new Set<ComposerListener>();
  private active: ActiveComposer | undefined;
  private manifest: AssetManifest | undefined;
  private failure: Error | undefined;
  private queue: Promise<void> = Promise.resolve();
  private reloadPending = false;
  private disposed = false;

  constructor(server: ViteDevServer, runner: ModuleRunner, settings: DevComposerSettings) {
    this.server = server;
    this.runner = runner;
    this.settings = settings;
    this.requestReload();
  }

  /**
   * GET of the stream path only. Waits for a pending reload, answers 503 while the show has never
   * loaded, and otherwise streams the current composer until the client leaves or the composer
   * is replaced.
   */
  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    if (request.method !== "GET" || request.url?.split("?", 1)[0] !== this.settings.streamPath) {
      return false;
    }
    await this.queue;
    const active = this.active;
    if (active === undefined) {
      response.statusCode = 503;
      response.setHeader("content-type", "text/plain; charset=utf-8");
      response.end(`Vignette dev composer is unavailable: ${this.failure?.message ?? "disposed"}`);
      return true;
    }
    const abort = new AbortController();
    response.on("close", () => {
      abort.abort();
    });
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    });
    try {
      const signal = AbortSignal.any([abort.signal, active.abort.signal]);
      const options = streamOptions(request.url ?? "/");
      for await (const message of active.composer.stream(signal, options)) {
        response.write(encodeStreamMessageSse(message));
      }
    } catch {
      // The composer was disposed between lookup and subscription; the client reconnects.
    } finally {
      response.end();
    }
    return true;
  }

  fileChanged(changed: string): void {
    // Watchers report native paths; Vite's module graphs key files by `/`-separated paths.
    const file = sep === "\\" ? changed.replaceAll("\\", "/") : changed;
    // Vite invalidates its own transform cache only after awaiting plugin hooks; do it first so
    // the reload below never re-imports the stale transform.
    this.server.environments.ssr.moduleGraph.onFileChange(file);
    // Edits outside the evaluated graph are ignored unless the last load failed; edits inside it
    // invalidate the changed modules and their importers before one coalesced reload.
    const modules = this.runner.evaluatedModules.getModulesByFile(file);
    if (modules === undefined || modules.size === 0) {
      // A failed load may not have evaluated the broken module; retry on any SSR-visible change.
      if (this.failure !== undefined) this.requestReload();
      return;
    }
    const seen = new Set<EvaluatedModuleNode>();
    for (const node of modules) this.invalidateWithImporters(node, seen);
    this.requestReload();
  }

  assetsChanged(): void {
    this.manifest = undefined;
    this.requestReload();
  }

  current(): Composer | undefined {
    return this.active?.composer;
  }

  onComposer(listener: ComposerListener): () => void {
    this.listeners.add(listener);
    if (this.active !== undefined) listener(this.active.composer);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    await this.queue;
    const active = this.active;
    this.active = undefined;
    if (active !== undefined) retire(active);
    await this.runner.close();
  }

  /** Invalidate a changed module and every evaluated importer so the next import re-executes them. */
  private invalidateWithImporters(node: EvaluatedModuleNode, seen: Set<EvaluatedModuleNode>): void {
    if (seen.has(node)) return;
    seen.add(node);
    const importers = [...node.importers];
    this.runner.evaluatedModules.invalidateModule(node);
    for (const id of importers) {
      const importer = this.runner.evaluatedModules.getModuleById(id);
      if (importer !== undefined) this.invalidateWithImporters(importer, seen);
    }
  }

  /** Coalesce change notifications into one queued reload. */
  private requestReload(): void {
    if (this.reloadPending || this.disposed) return;
    this.reloadPending = true;
    this.queue = this.queue.then(async () => {
      this.reloadPending = false;
      if (this.disposed) return;
      try {
        await this.reload();
        this.failure = undefined;
      } catch (cause) {
        this.failure = toError(cause);
        this.reportError(this.failure);
      }
    });
  }

  /** Hand the new export to the current composer, or replace it when its identity changed. */
  private async reload(): Promise<void> {
    const show = await this.load();
    const manifest = await this.loadManifest();
    const active = this.active;
    if (active !== undefined && active.manifest.version === manifest.version) {
      active.store.set(show);
      if (!(await identityChanged(active.composer))) return;
    }
    await this.replace(show, manifest);
  }

  private async replace(show: ShowExport, manifest: AssetManifest): Promise<void> {
    const origin = await this.settings.origin;
    const store = createShowStore(show);
    const composer = compose(createElement(DevShow, { store }), {
      assets: manifest,
      serve: {
        stream: `${origin}${this.settings.streamPath}`,
        assets: `${origin}${ASSETS_PATH}`,
        frames: `${origin}${FRAMES_HTML_PATH}`,
      },
      onError: (error) => {
        this.reportError(error);
      },
    });
    const previous = this.active;
    this.active = { composer, store, manifest, abort: new AbortController() };
    // Ending the previous composer's streams makes clients reconnect for the new setup.
    if (previous !== undefined) retire(previous);
    for (const listener of [...this.listeners]) listener(composer);
  }

  private async load(): Promise<ShowExport> {
    const exports: unknown = await this.runner.import(this.settings.show);
    const checked = ShowModuleSchema.safeParse(exports);
    if (!checked.success) {
      throw new Error(`${this.settings.show}: ${z.prettifyError(checked.error)}`);
    }
    const loaded: ShowModule = checked.data;
    return loaded.default;
  }

  /** The manifest of `assets/` next to the show, rescanned after `assetsChanged`. */
  private async loadManifest(): Promise<AssetManifest> {
    if (this.manifest !== undefined) return this.manifest;
    const dir = join(dirname(this.settings.show), "assets");
    const manifest = (await isDirectory(dir)) ? await scanAssets(dir) : createAssetManifest([]);
    this.manifest = manifest;
    return manifest;
  }

  private reportError(error: Error): void {
    this.server.config.logger.error(`[vignette] ${error.stack ?? error.message}`, { error });
  }
}

/** The root component of every dev composer: renders the latest show export from `store`. */
function DevShow({ store }: DevShowProps): ReactNode {
  const show = useSyncExternalStore(store.subscribe, store.get, store.get);
  return isValidElement(show) ? show : createElement(show);
}

function createShowStore(initial: ShowExport): ShowStore {
  let show = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => show,
    set: (next) => {
      show = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Settles pending React work; true when the show's ID or canvas changed (`SHOW_IDENTITY_CHANGED`). */
async function identityChanged(composer: Composer): Promise<boolean> {
  try {
    await composer.settled();
    return false;
  } catch {
    // Other render and compile errors already reached onError and the composer's status.
    return composer.status.diagnostics.some(({ code }) => code === "SHOW_IDENTITY_CHANGED");
  }
}

/** Ends the composer's streams before disposing it, so clients never see a teardown. */
function retire(active: ActiveComposer): void {
  active.abort.abort();
  active.composer.dispose();
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
