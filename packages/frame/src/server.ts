/**
 * Node request handling and production module hosting for Vignette frames.
 *
 * @module
 */
import { DEFAULT_BROWSER_SOURCE_CSS } from "@cbj/vignette-core";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";

import { isFrameDefinition, type FrameDefinition, type FrameMetadata } from "./definition.js";
import { serializeFrameParams } from "./serialization.js";
import { FRAME_ROUTE_PREFIX } from "./view.js";

/** Resolves server and browser modules needed to render and hydrate frames. */
export interface ModuleHost {
  /**
   * Optional: only needed by hosts that serve frames registered from transform metadata alone
   * (the Vite dev server). Frames registered from live definitions render without module loading.
   */
  loadModule?(moduleUrl: string): Promise<Record<string, unknown>>;
  resolveClientModule(moduleUrl: string): string;
  resolveClientHelper(): string;
}

/** Node HTTP handler that reports whether it consumed a request. */
export type NodeRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<boolean>;

interface FrameRouteEntry {
  readonly metadata: FrameMetadata;
  readonly definition?: FrameDefinition<object>;
}

/** Registry mapping deterministic frame route keys to frame definitions. */
export class FrameRouteRegistry {
  readonly #entries = new Map<string, FrameRouteEntry>();

  registerFromTransform(metadata: FrameMetadata): void {
    const previous = this.#checkCollision(metadata);
    // Never downgrade an entry that already carries a live definition.
    if (previous?.definition === undefined) this.#entries.set(metadata.routeKey, { metadata });
  }

  /** Registers a rendered frame so its route serves straight from the in-memory definition. */
  registerDefinition<Params extends object>(definition: FrameDefinition<Params>): void {
    const metadata = definition.metadata;
    if (metadata === undefined) {
      throw new Error(
        "Frame definition has no client metadata. Export it from a module processed by vignetteFrames().",
      );
    }
    this.#checkCollision(metadata);
    // Erasing Params is safe: the handler only feeds the definition's own parse() result back
    // into its own view, so the pairing is preserved at runtime.
    this.#entries.set(metadata.routeKey, {
      metadata,
      definition: definition as unknown as FrameDefinition<object>,
    });
  }

  get(routeKey: string): FrameRouteEntry | undefined {
    return this.#entries.get(routeKey);
  }

  #checkCollision(metadata: FrameMetadata): FrameRouteEntry | undefined {
    const previous = this.#entries.get(metadata.routeKey);
    if (
      previous !== undefined &&
      (previous.metadata.moduleUrl !== metadata.moduleUrl ||
        previous.metadata.exportName !== metadata.exportName)
    ) {
      throw new Error(`Frame route collision for '${metadata.routeKey}'.`);
    }
    return previous;
  }
}

/** Creates a Node handler for frame HTML and hydration-module routes. */
export function createFrameRequestHandler(
  host: ModuleHost,
  registry: FrameRouteRegistry,
): NodeRequestHandler {
  return async (request, response) => {
    if (request.url === undefined) return false;
    const url = new URL(request.url, "http://vignette.local");
    if (!url.pathname.startsWith(`${FRAME_ROUTE_PREFIX}/`)) return false;

    try {
      await handleFrameRequest(host, registry, url, response);
    } catch (error: unknown) {
      response.statusCode = error instanceof FrameRequestError ? error.statusCode : 500;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.end(error instanceof Error ? error.message : "Frame request failed.");
    }
    return true;
  };
}

async function handleFrameRequest(
  host: ModuleHost,
  registry: FrameRouteRegistry,
  url: URL,
  response: ServerResponse,
): Promise<void> {
  const route = url.pathname.slice(FRAME_ROUTE_PREFIX.length + 1).split("/");
  const routeKey = route[0];
  if (routeKey === undefined || routeKey.length === 0 || route.length > 2) {
    throw new FrameRequestError(404, "Frame route not found.");
  }
  const entry = registry.get(routeKey);
  if (entry === undefined) throw new FrameRequestError(404, "Frame route not found.");
  const registration = entry.metadata;

  if (route.length === 2) {
    if (route[1] !== "hydrate.js") throw new FrameRequestError(404, "Frame route not found.");
    response.statusCode = 200;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "text/javascript; charset=utf-8");
    response.end(createHydrationModule(host, registration));
    return;
  }

  const definition = entry.definition ?? (await loadFrameDefinition(host, registration));
  const raw = url.searchParams.get("props");
  if (raw === null) throw new FrameRequestError(400, "Frame request is missing its props payload.");
  let input: unknown;
  try {
    input = JSON.parse(raw) as unknown;
  } catch {
    throw new FrameRequestError(400, "Frame props payload is not valid JSON.");
  }
  let params: object;
  try {
    params = definition.params.parse(input);
  } catch (cause) {
    throw new FrameRequestError(
      400,
      `Frame props failed validation: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const serialized = serializeFrameParams(params);
  const markup = renderToString(createElement(definition.view, params));
  response.statusCode = 200;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(createFrameHtml(registration, serialized, markup));
}

async function loadFrameDefinition(
  host: ModuleHost,
  registration: FrameMetadata,
): Promise<FrameDefinition<object>> {
  if (host.loadModule === undefined) {
    throw new FrameRequestError(
      500,
      `Frame route '${registration.routeKey}' has no rendered definition and this host cannot load modules.`,
    );
  }
  const loaded: unknown = await host.loadModule(registration.moduleUrl);
  if (typeof loaded !== "object" || loaded === null) {
    throw new FrameRequestError(500, "Frame module did not return exports.");
  }
  const definition = (loaded as Record<string, unknown>)[registration.exportName];
  if (!isFrameDefinition(definition)) {
    throw new FrameRequestError(
      500,
      `Export '${registration.exportName}' is not a frame definition.`,
    );
  }
  return definition;
}

function createFrameHtml(
  registration: FrameMetadata,
  serializedParams: string,
  markup: string,
): string {
  const hydrationUrl = `${FRAME_ROUTE_PREFIX}/${registration.routeKey}/hydrate.js`;
  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>html, body, [data-vignette-frame-root] { width: 100%; height: 100%; } ${DEFAULT_BROWSER_SOURCE_CSS}</style>
  </head>
  <body>
    <div data-vignette-frame-root>${markup}</div>
    <script id="__vignette-frame-props" type="application/json">${escapeJsonForHtml(serializedParams)}</script>
    <script type="module" src="${hydrationUrl}"></script>
  </body>
</html>`;
}

function createHydrationModule(host: ModuleHost, registration: FrameMetadata): string {
  return `import * as frameModule from ${JSON.stringify(host.resolveClientModule(registration.moduleUrl))};
import { hydrateFrame } from ${JSON.stringify(host.resolveClientHelper())};
const definition = frameModule[${JSON.stringify(registration.exportName)}];
const element = document.querySelector('#__vignette-frame-props');
if (element === null || element.textContent === null) throw new Error('Frame props are missing.');
hydrateFrame(definition, JSON.parse(element.textContent));
`;
}

/** Vite client manifest location and hydration helper entry. */
export interface ClientManifestModuleHostOptions {
  /** Directory containing the Vite client build (with `.vite/manifest.json`). */
  readonly clientDirectory: string;
  /** Manifest key of the entry that re-exports `hydrateFrame`, e.g. "src/frame-client-entry.ts". */
  readonly clientHelperEntry: string;
}

/**
 * The production binding of the ModuleHost seam: hydration imports resolve through the Vite
 * client build manifest. Frame SSR uses definitions registered at render time, so no module
 * loading is required.
 */
export async function createClientManifestModuleHost(
  options: ClientManifestModuleHostOptions,
): Promise<ModuleHost> {
  const manifestPath = resolve(options.clientDirectory, ".vite/manifest.json");
  const manifest = readClientManifest(JSON.parse(await readFile(manifestPath, "utf8")));

  const resolveClientEntry = (sourceUrl: string): string => {
    const file = manifest[sourceUrl.replace(/^\//u, "")];
    if (file === undefined) throw new Error(`Client manifest has no entry for '${sourceUrl}'.`);
    return `/${file}`;
  };

  return {
    resolveClientModule: resolveClientEntry,
    resolveClientHelper: () => resolveClientEntry(options.clientHelperEntry),
  };
}

function readClientManifest(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The Vite client manifest is not an object.");
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "object" || entry === null) continue;
    const file = (entry as { readonly file?: unknown }).file;
    if (typeof file === "string") result[key] = file;
  }
  return result;
}

function escapeJsonForHtml(value: string): string {
  return value.replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
}

class FrameRequestError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
