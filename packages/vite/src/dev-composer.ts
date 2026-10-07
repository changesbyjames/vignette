import { z } from "zod";
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  createComposerRoot,
  type ComposerRoot,
  type CompositionDefinition,
} from "@strangecyan/vignette";
import {
  encodeStreamMessageSse,
  type AssetManifest,
  type SourceModule,
} from "@strangecyan/vignette-core";
import { createElement, type ComponentType } from "react";
import { createServerModuleRunner, type ViteDevServer } from "vite";
import type { EvaluatedModuleNode, ModuleRunner } from "vite/module-runner";

/** What `onComposerRoot` receives alongside each dev composer root. */
export interface ComposerRootContext {
  /** The composition the root was created for. */
  readonly composition: CompositionDefinition;
  readonly server: ViteDevServer;
  /** Aborts when the root is replaced (identity change) or the dev server closes. */
  readonly signal: AbortSignal;
}

/**
 * Attaches an extra consumer (for example an embedded OBS runtime) to a dev composer root. It is
 * called again for every replacement root. Return a promise that settles once the consumer has
 * released its resources after `signal` aborts; replacement and server close wait for it.
 */
export type ComposerRootHook = (
  root: ComposerRoot,
  context: ComposerRootContext,
) => void | Promise<void>;

/** Resolved dev composer settings derived from the plugin options. */
export interface DevComposerSettings {
  /** Absolute path of the composition module. */
  readonly module: string;
  readonly streamPath: string;
  readonly manifest: () => AssetManifest;
  readonly onComposerRoot: ComposerRootHook | undefined;
}

/** A dev-server composer that reloads its composition when the module graph changes. */
export interface DevComposer {
  /** Serves the composer stream over SSE; resolves false for requests it does not own. */
  handle(request: IncomingMessage, response: ServerResponse): Promise<boolean>;
  /** Reloads when `file` belongs to the composition's evaluated module graph. */
  fileChanged(file: string): void;
  /** Replaces the root when the asset manifest changed. */
  assetsChanged(): void;
  dispose(): Promise<void>;
}

interface ActiveComposer {
  readonly root: ComposerRoot;
  readonly composition: CompositionDefinition;
  readonly manifest: AssetManifest;
  readonly abort: AbortController;
  readonly consumer: Promise<void>;
}

/** Checks the `defineComposition` fields so a bad export gets a precise message. */
const CompositionFieldsSchema = z.object(
  {
    composition: z.object({
      id: z.string().min(1),
      canvas: z.object({
        width: z.number().positive(),
        height: z.number().positive(),
        frameRate: z.number().positive().optional(),
      }),
      extensions: z.array(z.custom<SourceModule>((value) => value instanceof Object)).optional(),
      component: z.custom<ComponentType>((value) => value instanceof Function),
    }),
  },
  { error: "The module has no `composition` export." },
);

type CompositionFields = z.output<typeof CompositionFieldsSchema>;

/** Keeps the module's own (frozen) definition rather than a parsed copy. */
const CompositionModuleSchema = z.object({
  composition: z.custom<CompositionDefinition>((value) => value instanceof Object),
});

type CompositionModule = z.output<typeof CompositionModuleSchema>;

/** Starts composing `settings.module` in the dev server's SSR environment. */
export function createDevComposer(
  server: ViteDevServer,
  settings: DevComposerSettings,
): DevComposer {
  return new DevComposerImpl(server, settings);
}

class DevComposerImpl implements DevComposer {
  private readonly server: ViteDevServer;
  private readonly settings: DevComposerSettings;
  private readonly runner: ModuleRunner;
  private active: ActiveComposer | undefined;
  private failure: Error | undefined;
  private queue: Promise<void> = Promise.resolve();
  private reloadPending = false;
  private disposed = false;

  constructor(server: ViteDevServer, settings: DevComposerSettings) {
    this.server = server;
    this.settings = settings;
    // A dedicated runner without HMR keeps evaluated modules until this composer invalidates them.
    this.runner = createServerModuleRunner(server.environments.ssr, { hmr: false });
    this.requestReload();
  }

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
    // Reconnect quickly when a replaced root closes this stream.
    response.write("retry: 250\n\n");
    try {
      // Retiring a root aborts its streams before it unmounts, so clients never see the teardown.
      const signal = AbortSignal.any([abort.signal, active.abort.signal]);
      for await (const message of active.root.messages(signal)) {
        response.write(encodeStreamMessageSse(message));
      }
    } catch {
      // The root was disposed between lookup and subscription; the client reconnects.
    } finally {
      response.end();
    }
    return true;
  }

  fileChanged(file: string): void {
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
    if (this.active?.manifest.version === this.settings.manifest().version) return;
    this.requestReload();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.queue;
    const active = this.active;
    this.active = undefined;
    if (active !== undefined) await this.retire(active);
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

  /** Re-render the current root, or replace it when the composition's runtime identity changed. */
  private async reload(): Promise<void> {
    const composition = await this.load();
    const manifest = this.settings.manifest();
    const active = this.active;
    if (active !== undefined && sameIdentity(active, composition, manifest)) {
      this.active = { ...active, composition };
      await this.render(active.root, composition);
      return;
    }

    const root = createComposerRoot(composition, {
      assets: manifest,
      onError: (error) => {
        this.reportError(error);
      },
    });
    await this.render(root, composition);
    const abort = new AbortController();
    this.active = {
      root,
      composition,
      manifest,
      abort,
      consumer: this.attach(root, composition, abort.signal),
    };
    // Disposing the previous root ends its SSE streams so clients reconnect for the new setup.
    if (active !== undefined) await this.retire(active);
  }

  private async load(): Promise<CompositionDefinition> {
    const exports: unknown = await this.runner.import(this.settings.module);
    const checked: z.ZodSafeParseResult<CompositionFields> =
      CompositionFieldsSchema.safeParse(exports);
    if (!checked.success) {
      throw new Error(
        `${this.settings.module} must export \`composition\` from defineComposition({ id, canvas, component }).\n${z.prettifyError(checked.error)}`,
      );
    }
    const loaded: CompositionModule = CompositionModuleSchema.parse(exports);
    return loaded.composition;
  }

  private async render(root: ComposerRoot, composition: CompositionDefinition): Promise<void> {
    try {
      await root.render(createElement(composition.component));
    } catch {
      // Render and compile errors already reached onError; the root reports them as status.
    }
  }

  private async attach(
    root: ComposerRoot,
    composition: CompositionDefinition,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      await this.settings.onComposerRoot?.(root, { composition, server: this.server, signal });
    } catch (cause) {
      this.reportError(toError(cause));
    }
  }

  private async retire(active: ActiveComposer): Promise<void> {
    active.abort.abort();
    await Promise.all([active.root.dispose(), active.consumer]);
  }

  private reportError(error: Error): void {
    this.server.config.logger.error(`[vignette] ${error.stack ?? error.message}`, { error });
  }
}

/** Roots are fixed to one project ID, canvas, extension set, and asset manifest. */
function sameIdentity(
  active: ActiveComposer,
  composition: CompositionDefinition,
  manifest: AssetManifest,
): boolean {
  const previous = active.composition;
  const previousExtensions = previous.extensions ?? [];
  const extensions = composition.extensions ?? [];
  return (
    previous.id === composition.id &&
    previous.canvas.width === composition.canvas.width &&
    previous.canvas.height === composition.canvas.height &&
    previous.canvas.frameRate === composition.canvas.frameRate &&
    previousExtensions.length === extensions.length &&
    previousExtensions.every((module, index) => module === extensions[index]) &&
    active.manifest.version === manifest.version
  );
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
