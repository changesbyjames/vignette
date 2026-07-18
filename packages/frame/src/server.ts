/** Fetch routing and pure SSR kernels for Vignette frames. */
import { DEFAULT_BROWSER_SOURCE_CSS } from "@strangecyan/vignette-core";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import type { FrameDefinition, FrameMetadata } from "./definition.js";
import { serializeFrameParams } from "./serialization.js";
import { FRAME_ROUTE_PREFIX } from "./view.js";

/** Resolves browser modules needed to hydrate statically registered frames. */
export interface FrameModuleHost {
  resolveClientModule(moduleUrl: string): string;
  resolveClientHelper(): string;
}

/** Static definitions and browser module resolution for all built frames. */
export interface FrameBundle {
  readonly registry: FrameRouteRegistry;
  readonly modules: FrameModuleHost;
}

/** Fetch handler that leaves unrelated requests unhandled. */
export type FrameRequestHandler = (
  request: Request,
) => Response | Promise<Response | undefined> | undefined;

/** One live frame definition and its build-derived route metadata. */
export interface FrameRouteEntry {
  readonly metadata: FrameMetadata;
  readonly definition: FrameDefinition<object>;
}

/** Registry of live frame definitions keyed by deterministic build metadata. */
export class FrameRouteRegistry {
  readonly #entries = new Map<string, FrameRouteEntry>();

  registerDefinition<Params extends object>(definition: FrameDefinition<Params>): void {
    const metadata = definition.metadata;
    if (metadata === undefined) {
      throw new Error(
        "Frame definition has no client metadata. Export it from a module processed by vignette().",
      );
    }
    const previous = this.#entries.get(metadata.routeKey);
    if (
      previous !== undefined &&
      (previous.metadata.moduleUrl !== metadata.moduleUrl ||
        previous.metadata.exportName !== metadata.exportName)
    ) {
      throw new Error(`Frame route collision for '${metadata.routeKey}'.`);
    }
    this.#entries.set(metadata.routeKey, {
      metadata,
      definition: definition as unknown as FrameDefinition<object>,
    });
  }

  get(routeKey: string): FrameRouteEntry | undefined {
    return this.#entries.get(routeKey);
  }
}

/** Validates props, server-renders a frame, and wraps it in its hydration document. */
export function renderFrameHtml<Params extends object>(
  definition: FrameDefinition<Params>,
  metadata: FrameMetadata,
  rawProps: unknown,
): string {
  let params: Params;
  try {
    params = definition.params.parse(rawProps);
  } catch (cause) {
    throw new FrameRequestError(
      400,
      `Frame props failed validation: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const serialized = serializeFrameParams(params);
  const markup = renderToString(createElement(definition.view, params));
  const hydrationUrl = `${FRAME_ROUTE_PREFIX}/${metadata.routeKey}/hydrate.js`;
  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>html, body, [data-vignette-frame-root] { width: 100%; height: 100%; } ${DEFAULT_BROWSER_SOURCE_CSS}</style>
  </head>
  <body>
    <div data-vignette-frame-root>${markup}</div>
    <script id="__vignette-frame-props" type="application/json">${escapeJsonForHtml(serialized)}</script>
    <script type="module" src="${hydrationUrl}"></script>
  </body>
</html>`;
}

/** Generates the browser module that imports and hydrates one frame definition. */
export function renderHydrationModule(modules: FrameModuleHost, metadata: FrameMetadata): string {
  return `import * as frameModule from ${JSON.stringify(modules.resolveClientModule(metadata.moduleUrl))};
import { hydrateFrame } from ${JSON.stringify(modules.resolveClientHelper())};
const definition = frameModule[${JSON.stringify(metadata.exportName)}];
const element = document.querySelector('#__vignette-frame-props');
if (element === null || element.textContent === null) throw new Error('Frame props are missing.');
hydrateFrame(definition, JSON.parse(element.textContent));
`;
}

/** Creates a Fetch handler over a static frame bundle. */
export function createFrameRequestHandler(frames: FrameBundle): FrameRequestHandler {
  return (request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`${FRAME_ROUTE_PREFIX}/`)) return undefined;
    try {
      const route = url.pathname.slice(FRAME_ROUTE_PREFIX.length + 1).split("/");
      const routeKey = route[0];
      if (routeKey === undefined || routeKey.length === 0 || route.length > 2) {
        throw new FrameRequestError(404, "Frame route not found.");
      }
      const entry = frames.registry.get(routeKey);
      if (entry === undefined) throw new FrameRequestError(404, "Frame route not found.");
      if (route.length === 2) {
        if (route[1] !== "hydrate.js") throw new FrameRequestError(404, "Frame route not found.");
        return new Response(renderHydrationModule(frames.modules, entry.metadata), {
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "text/javascript; charset=utf-8",
          },
        });
      }
      const raw = url.searchParams.get("props");
      if (raw === null)
        throw new FrameRequestError(400, "Frame request is missing its props payload.");
      let input: unknown;
      try {
        input = JSON.parse(raw) as unknown;
      } catch {
        throw new FrameRequestError(400, "Frame props payload is not valid JSON.");
      }
      return new Response(renderFrameHtml(entry.definition, entry.metadata, input), {
        headers: { "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (error: unknown) {
      return new Response(error instanceof Error ? error.message : "Frame request failed.", {
        status: error instanceof FrameRequestError ? error.statusCode : 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  };
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
