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
import type { Plugin } from "vite";

const FRAMES_ID = "virtual:vignette/frames";
const ASSETS_ID = "virtual:vignette/assets";
const RESOLVED_FRAMES_ID = `\0${FRAMES_ID}`;
const RESOLVED_ASSETS_ID = `\0${ASSETS_ID}`;
// The browser loads this entry by URL rather than through the plugin's module graph.
const HELPER_ENTRY = fileURLToPath(new URL("./frame-client.js", import.meta.url));

/** Static frame and composition-asset discovery configured relative to the Vite root. */
export interface VignettePluginOptions {
  /** Frame-module globs relative to the Vite root. */
  readonly frames?: string | readonly string[];
  /** Composition-asset globs relative to the Vite root. */
  readonly assets?: string | readonly string[];
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
        entryFileNames: (chunk) => {
          if (chunk.name === "vignette-frame-client") return "assets/vignette/frame-client.js";
          if (chunk.name.startsWith("vignette-frame-")) {
            return `assets/vignette/frame/${chunk.name.slice("vignette-frame-".length)}.js`;
          }
          return typeof fallback === "function"
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
    configureServer(server) {
      let handler: Promise<ReturnType<typeof createNodeFrameRequestHandler>> | undefined;
      const getHandler = () => {
        handler ??= server.ssrLoadModule(FRAMES_ID).then((loaded: Record<string, unknown>) => {
          const bundle = loaded.frames as FrameBundle | undefined;
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
            (error: unknown) => {
              next(error);
            },
          );
      });
      server.watcher.on("add", () => {
        discover();
        handler = undefined;
      });
      server.watcher.on("unlink", () => {
        discover();
        handler = undefined;
      });
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

function clientInputs(registrations: readonly FrameRegistration[]): Record<string, string> {
  const frameByFile = new Map<string, FrameRegistration>();
  for (const registration of registrations) frameByFile.set(registration.file, registration);
  const vignetteInputs: Record<string, string> = { "vignette-frame-client": HELPER_ENTRY };
  for (const [file, registration] of frameByFile) {
    vignetteInputs[`vignette-frame-${registration.routeKey}`] = file;
  }
  return vignetteInputs;
}

function normalizeInput(
  input: string | readonly string[] | Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  if (input === undefined) return {};
  if (typeof input === "string") return { index: input };
  if (Array.isArray(input)) {
    return Object.fromEntries(input.map((entry, index) => [`entry-${String(index)}`, entry]));
  }
  return { ...(input as Readonly<Record<string, string>>) };
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
