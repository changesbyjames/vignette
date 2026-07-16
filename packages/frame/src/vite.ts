/**
 * Vite plugin and development module host for discovering and serving Vignette frames.
 *
 * @module
 */
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";

import { createNodeFrameRequestHandler } from "./node-server.js";
import { createFrameRequestHandler, FrameRouteRegistry, type ModuleHost } from "./server.js";
import { transformFrameDefinitions } from "./transform.js";

export { FrameRouteRegistry } from "./server.js";

/**
 * The development binding of the ModuleHost seam: modules load through Vite's SSR pipeline and
 * client URLs are the dev-server module URLs, with the hydration helper served via `/@fs/`.
 */
export function createDevServerModuleHost(server: ViteDevServer): ModuleHost {
  const clientPath = normalizePath(fileURLToPath(new URL("./client.js", import.meta.url)));
  return {
    loadModule: (moduleUrl) => server.ssrLoadModule(moduleUrl),
    resolveClientModule: (moduleUrl) => moduleUrl,
    resolveClientHelper: () => `/@fs/${clientPath}`,
  };
}

/** Creates the Vite plugin that discovers, serves, and transforms frame modules. */
export function vignetteFrames(registry: FrameRouteRegistry = new FrameRouteRegistry()): Plugin {
  let config: ResolvedConfig | undefined;
  return {
    name: "vignette-frames",
    enforce: "pre",
    configResolved(resolved) {
      config = resolved;
    },
    transform(code, id) {
      if (config === undefined) throw new Error("Vite config was not resolved before transform.");
      const cleanId = id.split("?", 1)[0];
      if (cleanId === undefined || cleanId.includes(`${sep}node_modules${sep}`)) return null;
      return transformFrameModule(code, cleanId, config.root, registry);
    },
    configureServer(server) {
      const handleRequest = createNodeFrameRequestHandler(
        createFrameRequestHandler(createDevServerModuleHost(server), registry),
      );
      server.middlewares.use((request, response, next) => {
        void handleRequest(request, response).then(
          (handled) => {
            if (!handled) next();
          },
          (error: unknown) => {
            next(error);
          },
        );
      });
    },
  };
}

/** Injects deterministic client metadata into exported `frame()` definitions. */
export function transformFrameModule(
  code: string,
  id: string,
  root: string,
  registrations: FrameRouteRegistry = new FrameRouteRegistry(),
): { readonly code: string; readonly map: null } | null {
  const moduleUrl = toModuleUrl(id, root);
  return transformFrameDefinitions(code, {
    id,
    moduleUrl,
    onMetadata: (metadata) => {
      registrations.registerFromTransform(metadata);
    },
  });
}

function toModuleUrl(id: string, root: string): string {
  const relativeId = relative(root, id);
  if (!relativeId.startsWith("..") && !relativeId.startsWith(sep)) {
    return `/${normalizePath(relativeId)}`;
  }
  return `/@fs/${normalizePath(id)}`;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}
