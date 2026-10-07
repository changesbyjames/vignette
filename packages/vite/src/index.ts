import { z } from "zod";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { AssetManifest, AssetManifestEntry } from "@strangecyan/vignette-core";
import type { FrameMetadata } from "@strangecyan/vignette-frame";
import { createFrameRequestHandler, type FrameBundle } from "@strangecyan/vignette-frame/server";
import { createNodeFrameRequestHandler } from "@strangecyan/vignette-frame/server/node";
import { transformFrameDefinitions } from "@strangecyan/vignette-frame/transform";
import { globSync } from "tinyglobby";
import type { Plugin, UserConfig } from "vite";

import type { ComposerRootHook, DevComposer } from "./dev-composer.js";

export type { ComposerRootContext, ComposerRootHook } from "./dev-composer.js";

const FRAMES_ID = "virtual:vignette/frames";
const ASSETS_ID = "virtual:vignette/assets";
const RESOLVED_FRAMES_ID = `\0${FRAMES_ID}`;
const RESOLVED_ASSETS_ID = `\0${ASSETS_ID}`;
// The browser loads this entry by URL rather than through the plugin's module graph.
const HELPER_ENTRY = fileURLToPath(new URL("./frame-client.js", import.meta.url));

/** Frame and asset discovery, plus the optional dev composer, configured relative to the Vite root. */
export interface VignettePluginOptions {
  /** Frame-module globs relative to the Vite root. */
  readonly frames?: string | readonly string[];
  /** Composition-asset globs relative to the Vite root. */
  readonly assets?: string | readonly string[];
  /**
   * Composition module (relative to the Vite root) whose `composition` export `vite dev` composes
   * and streams at `runtimePath`. Edits to the module or its imports re-render the same root;
   * changing `id`, `canvas`, `extensions`, or the asset manifest replaces the root and closes open
   * streams so clients reconnect and receive the new setup. Omit to host the composer yourself.
   */
  readonly composition?: string;
  /** Path of the dev composer's runtime SSE stream. Defaults to `/runtime`. */
  readonly runtimePath?: string;
  /** Attaches extra consumers, such as an embedded OBS runtime, to each dev composer root. */
  readonly onComposerRoot?: ComposerRootHook;
}

/**
 * Defaults contributed alongside the user's configuration. Vite concatenates these arrays with the
 * user's own, so nothing the user configured is replaced.
 */
function configDefaults(command: "build" | "serve"): UserConfig {
  const defaults: UserConfig = {
    // yoga-layout initializes with top-level await, which the dependency optimizer cannot target.
    optimizeDeps: { exclude: ["yoga-layout"] },
    // Frames, hooks, and the reconciler require exactly one React instance.
    resolve: { dedupe: ["react", "react-dom"] },
  };
  if (command === "serve") {
    // During development this plugin renders frames and composes through Node-loaded copies of
    // these packages; SSR-evaluated application modules must share those instances even when the
    // packages are linked workspace sources that Vite would otherwise inline.
    defaults.ssr = { external: ["@strangecyan/vignette", "@strangecyan/vignette-frame"] };
  }
  return defaults;
}

type InputEntries = Record<string, string>;

interface FrameModuleExports {
  readonly frames?: FrameBundle;
}

interface FrameRegistration extends FrameMetadata {
  readonly file: string;
}

interface AssetRegistration extends AssetManifestEntry {
  readonly file: string;
  readonly bytes: Uint8Array;
  readonly hash: string;
  readonly buildUrl: string;
  readonly integrity: `sha256-${string}`;
}

/** Creates Vignette's frame transform, static registries, client entries, and asset manifest. */
export function vignette(options: VignettePluginOptions = {}): Plugin {
  let root = process.cwd();
  let command: "build" | "serve" = "serve";
  let frames: readonly FrameRegistration[] = [];
  let assets: readonly AssetRegistration[] = [];
  let composer: DevComposer | undefined = undefined;

  const discover = () => {
    frames = discoverFrames(root, options.frames);
    assets = discoverAssets(root, options.assets);
  };

  return {
    name: "vignette",
    enforce: "pre",
    sharedDuringBuild: true,
    config(config, env) {
      root = resolve(config.root ?? process.cwd());
      command = env.command;
      discover();
      return configDefaults(env.command);
    },
    configResolved(config) {
      root = config.root;
      discover();
    },
    resolveId(source) {
      if (source === FRAMES_ID) return RESOLVED_FRAMES_ID;
      if (source === ASSETS_ID) return RESOLVED_ASSETS_ID;
      return null;
    },
    load(id) {
      if (id === RESOLVED_FRAMES_ID) {
        return generateFramesModule(frames, command === "serve");
      }
      if (id === RESOLVED_ASSETS_ID) {
        return `export const assets = ${JSON.stringify(createAssetManifest(assets, command))};`;
      }
      return null;
    },
    transform(code, id) {
      const cleanId = id.split("?", 1)[0];
      if (cleanId === undefined || cleanId.includes(`${sep}node_modules${sep}`)) return null;
      return transformFrameDefinitions(code, {
        id: cleanId,
        moduleUrl: toModuleUrl(cleanId, root),
      });
    },
    options(inputOptions) {
      if (command !== "build" || this.environment.name !== "client") return null;
      return {
        ...inputOptions,
        input: { ...normalizeInput(inputOptions.input), ...clientInputs(frames) },
        preserveEntrySignatures: "strict",
      };
    },
    outputOptions(outputOptions) {
      if (command !== "build" || this.environment.name !== "client") return null;
      const fallback = outputOptions.entryFileNames;
      return {
        ...outputOptions,
        entryFileNames:
          /** Frame client entries use stable dedicated filenames while other chunks retain the normal output naming. */
          (chunk) => {
            if (chunk.name === "vignette-frame-client") return "assets/vignette/frame-client.js";
            if (chunk.name.startsWith("vignette-frame-")) {
              return `assets/vignette/frame/${chunk.name.slice("vignette-frame-".length)}.js`;
            }
            return fallback instanceof Function
              ? fallback(chunk)
              : (fallback ?? "assets/[name]-[hash].js");
          },
      };
    },
    buildStart() {
      if (this.environment.name !== "client") return;
      for (const asset of assets) {
        this.emitFile({ type: "asset", fileName: asset.buildUrl.slice(1), source: asset.bytes });
      }
    },
    async configureServer(server) {
      if (options.composition !== undefined) {
        // Loaded lazily so configurations without a dev composer never import React.
        const { createDevComposer } = await import("./dev-composer.js");
        const devComposer = createDevComposer(server, {
          module: resolve(root, options.composition),
          runtimePath: options.runtimePath ?? "/runtime",
          manifest: () => createAssetManifest(assets, "serve"),
          onComposerRoot: options.onComposerRoot,
        });
        composer = devComposer;
        server.middlewares.use((request, response, next) => {
          devComposer.handle(request, response).then(
            (handled) => {
              if (!handled) next();
            },
            (cause: unknown) => {
              next(cause);
            },
          );
        });
      }

      let handler: Promise<ReturnType<typeof createNodeFrameRequestHandler>> | undefined =
        undefined;
      const getHandler = () => {
        handler ??= server.ssrLoadModule(FRAMES_ID).then((loaded: FrameModuleExports) => {
          const bundle = loaded.frames;
          if (bundle === undefined) throw new Error("The Vignette frame registry did not load.");
          return createNodeFrameRequestHandler(createFrameRequestHandler(bundle));
        });
        return handler;
      };
      server.middlewares.use((request, response, next) => {
        void getHandler()
          .then((handle) => handle(request, response))
          .then(
            (handled) => {
              if (!handled) next();
            },
            (cause: unknown) => {
              next(cause);
            },
          );
      });
      const rediscover = () => {
        discover();
        handler = undefined;
        composer?.assetsChanged();
      };
      server.watcher.on("add", rediscover);
      server.watcher.on("unlink", rediscover);
    },
    hotUpdate(update) {
      // The dev composer evaluates through the SSR environment, whose module graph sees the edit.
      if (this.environment.name === "ssr") composer?.fileChanged(update.file);
    },
    async closeBundle() {
      // Vite closes every environment's plugin container when the dev server closes.
      const closing = composer;
      composer = undefined;
      await closing?.dispose();
    },
  };
}

function discoverFrames(
  root: string,
  patterns: string | readonly string[] | undefined,
): FrameRegistration[] {
  const files = globSync(patterns ?? "src/**/*.frame.{tsx,jsx}", {
    cwd: root,
    absolute: true,
    onlyFiles: true,
  }).sort();
  const registrations: FrameRegistration[] = [];
  for (const file of files) {
    transformFrameDefinitions(readFileSync(file, "utf8"), {
      id: file,
      moduleUrl: toModuleUrl(file, root),
      onMetadata: (metadata) => registrations.push({ ...metadata, file }),
    });
  }
  return registrations.sort((left, right) => left.routeKey.localeCompare(right.routeKey));
}

function discoverAssets(
  root: string,
  patterns: string | readonly string[] | undefined,
): AssetRegistration[] {
  if (patterns === undefined || (Array.isArray(patterns) && patterns.length === 0)) return [];
  return globSync(patterns, { cwd: root, absolute: true, onlyFiles: true })
    .sort()
    .map((file) => {
      const bytes = readFileSync(file);
      const hash = createHash("sha256").update(bytes).digest("base64");
      const name = normalizePath(relative(root, file));
      const extension = extname(name);
      const stem = extension.length === 0 ? name : name.slice(0, -extension.length);
      const hash8 = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
      return {
        file,
        bytes,
        hash,
        name,
        url: `/${name}`,
        integrity: `sha256-${hash}` as const,
        buildUrl: `/assets/vignette/asset/${stem}-${hash8}${extension}`,
      };
    });
}

function createAssetManifest(
  registrations: readonly AssetRegistration[],
  command: "build" | "serve",
): AssetManifest {
  if (registrations.length === 0) return { version: 1, assets: [] };
  const version = createHash("sha256")
    .update(registrations.map((asset) => `${asset.name}:${asset.hash}`).join("\n"))
    .digest("base64");
  return {
    version: `sha256-${version}`,
    assets: registrations.map((asset) => ({
      name: asset.name,
      url: command === "build" ? asset.buildUrl : asset.url,
      integrity: asset.integrity,
    })),
  };
}

function generateFramesModule(registrations: readonly FrameRegistration[], dev: boolean): string {
  const modules = [...new Set(registrations.map((registration) => registration.file))];
  const imports = modules.map(
    (file, index) => `import * as frame${String(index)} from ${JSON.stringify(toViteId(file))};`,
  );
  const indexes = new Map(modules.map((file, index) => [file, index]));
  const registrationsCode = registrations.map((registration) => {
    const index = indexes.get(registration.file);
    if (index === undefined) throw new Error("Frame module registration is inconsistent.");
    return `registry.registerDefinition(frame${String(index)}[${JSON.stringify(registration.exportName)}]);`;
  });
  const clientUrls = Object.fromEntries(
    registrations.map((registration) => [
      registration.moduleUrl,
      dev ? registration.moduleUrl : `/assets/vignette/frame/${registration.routeKey}.js`,
    ]),
  );
  return `${imports.join("\n")}
import { FrameRouteRegistry } from "@strangecyan/vignette-frame/server";
const registry = new FrameRouteRegistry();
${registrationsCode.join("\n")}
const clientUrls = ${JSON.stringify(clientUrls)};
const modules = {
  resolveClientModule(url) {
    const resolved = clientUrls[url];
    if (resolved === undefined) throw new Error(\`No client frame entry for '\${url}'.\`);
    return resolved;
  },
  resolveClientHelper() { return ${JSON.stringify(dev ? `/@fs/${normalizePath(HELPER_ENTRY)}` : "/assets/vignette/frame-client.js")}; },
};
export const frames = { registry, modules };
`;
}

function clientInputs(registrations: readonly FrameRegistration[]) {
  const frameByFile = new Map<string, FrameRegistration>();
  for (const registration of registrations) frameByFile.set(registration.file, registration);
  const vignetteInputs: InputEntries = {};
  vignetteInputs["vignette-frame-client"] = HELPER_ENTRY;
  for (const [file, registration] of frameByFile) {
    vignetteInputs[`vignette-frame-${registration.routeKey}`] = file;
  }
  return vignetteInputs;
}

function normalizeInput(input: string | readonly string[] | Readonly<InputEntries> | undefined) {
  if (input === undefined) return {};
  const scalar = z.string().safeParse(input);
  if (scalar.success) return { index: scalar.data };
  if (Array.isArray(input)) {
    return Object.fromEntries(input.map((entry, index) => [`entry-${String(index)}`, entry]));
  }
  return z.record(z.string(), z.string()).parse(input);
}

function toModuleUrl(id: string, root: string): string {
  const relativeId = relative(root, id);
  if (!relativeId.startsWith("..") && !relativeId.startsWith(sep))
    return `/${normalizePath(relativeId)}`;
  return `/@fs/${normalizePath(id)}`;
}

function toViteId(file: string): string {
  return `/@fs/${normalizePath(file)}`;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}
