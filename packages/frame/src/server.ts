/** Fetch routing and pure SSR kernels for Vignette frames. */
import {
  DEFAULT_BROWSER_SOURCE_CSS,
  omitUndefined,
  type CompiledSnapshot,
} from "@strangecyan/vignette-core";
import { renderToString } from "react-dom/server";

import type { FrameMountOptions } from "./client.js";
import type { FrameDefinition, FrameMetadata } from "./definition.js";
import { frameElement } from "./frame-element.js";
import { pageProps } from "./page-props.js";
import type { FrameJsonObject } from "./serialization.js";
import { FRAME_ROUTE_PREFIX } from "./view.js";

/** Resolves browser modules needed to mount statically registered frames. */
export interface FrameModuleHost {
  resolveClientModule(moduleUrl: string): string;
  resolveClientHelper(): string;
}

/** Static definitions and browser module resolution for all built frames. */
export interface FrameBundle {
  readonly registry: FrameRouteRegistry;
  readonly modules: FrameModuleHost;
}

/** Where frame pages read their live props, and optionally how the server renders them first. */
export interface FrameServerOptions {
  /** Composer stream URL the page subscribes to. Defaults to `/stream`. */
  readonly stream?: string | undefined;
  /**
   * The composer's current snapshot, when the frame host runs beside the composer. Pages are then
   * server-rendered with their current props; otherwise they render once the first update arrives.
   */
  readonly snapshot?: (() => CompiledSnapshot | undefined) | undefined;
}

/** Fetch handler that leaves unrelated requests unhandled. */
export type FrameRequestHandler = (request: Request) => Response | undefined;

/** One resolved frame route as plain data, so any HTTP framework can send it directly. */
export interface FrameResult {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** One live frame definition's route metadata and its typed page renderer. */
export interface FrameRouteEntry {
  readonly metadata: FrameMetadata;
  readonly render: (request: FramePageRequest) => string;
}

/** Everything one frame page needs: which placement it is, where its props come from, and its modules. */
export interface FramePageRequest {
  readonly sourceId: string;
  readonly stream: string;
  readonly modules: FrameModuleHost;
  /** Current page props, when known; the page is then server-rendered with them. */
  readonly props?: FrameJsonObject | undefined;
}

/** Registry of live frame definitions keyed by deterministic build metadata. */
export class FrameRouteRegistry {
  private readonly entries = new Map<string, FrameRouteEntry>();

  /** Require build metadata and reject route collisions before retaining the definition. */
  registerDefinition<Params extends object>(definition: FrameDefinition<Params>): void {
    const metadata = definition.metadata;
    if (metadata === undefined) {
      throw new Error(
        "Frame definition has no client metadata. Export it from a module processed by vignette().",
      );
    }
    const previous = this.entries.get(metadata.routeKey);
    if (
      previous !== undefined &&
      (previous.metadata.moduleUrl !== metadata.moduleUrl ||
        previous.metadata.exportName !== metadata.exportName)
    ) {
      throw new Error(`Frame route collision for '${metadata.routeKey}'.`);
    }
    this.entries.set(metadata.routeKey, {
      metadata,
      render: (request) => renderFrameHtml(definition, metadata, request),
    });
  }

  get(routeKey: string): FrameRouteEntry | undefined {
    return this.entries.get(routeKey);
  }
}

/**
 * Renders a frame page. With props, the view is server-rendered and hydrated; without them the
 * page renders on the client once the stream delivers them. Either way it then follows the stream.
 */
export function renderFrameHtml<Params extends object>(
  definition: FrameDefinition<Params>,
  metadata: FrameMetadata,
  request: FramePageRequest,
): string {
  const markup =
    request.props === undefined
      ? ""
      : renderToString(frameElement(definition, parseFrameParams(definition, request.props)));
  const mount: FrameMountOptions = {
    sourceId: request.sourceId,
    stream: request.stream,
    ...omitUndefined({ initialProps: request.props }),
  };
  const bootstrap = `import * as frameModule from ${JSON.stringify(request.modules.resolveClientModule(metadata.moduleUrl))};
import { mountFrame } from ${JSON.stringify(request.modules.resolveClientHelper())};
mountFrame(frameModule[${JSON.stringify(metadata.exportName)}], ${JSON.stringify(mount)});`;
  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>html, body, [data-vignette-frame-root] { width: 100%; height: 100%; } ${DEFAULT_BROWSER_SOURCE_CSS}</style>
  </head>
  <body>
    <div data-vignette-frame-root>${markup}</div>
    <script type="module">${escapeScript(bootstrap)}</script>
  </body>
</html>`;
}

function parseFrameParams<Params extends object>(
  definition: FrameDefinition<Params>,
  props: FrameJsonObject,
): Params {
  try {
    return definition.params.parse(props);
  } catch (cause) {
    throw new FrameRequestError(
      500,
      `Frame props failed validation: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

/**
 * Resolves a request target (path plus query string, such as Node's `req.url`) against a static
 * frame bundle. Returns undefined outside the frame route prefix so hosts can fall through:
 *
 * ```ts
 * const frame = resolveFrame(frames, req.url, { snapshot: () => root.snapshot });
 * if (frame === undefined) return next();
 * res.writeHead(frame.status, frame.headers).end(frame.body);
 * ```
 */
export function resolveFrame(
  frames: FrameBundle,
  target: string,
  options: FrameServerOptions = {},
): FrameResult | undefined {
  const queryStart = target.indexOf("?");
  const pathname = queryStart === -1 ? target : target.slice(0, queryStart);
  if (!pathname.startsWith(`${FRAME_ROUTE_PREFIX}/`)) return undefined;
  try {
    return renderFrameRoute(frames, pathname, options);
  } catch (error: unknown) {
    // Request errors carry their HTTP status; anything else is a server-side rendering failure.
    return {
      status: error instanceof FrameRequestError ? error.statusCode : 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: error instanceof Error ? error.message : "Frame request failed.",
    };
  }
}

/** Serves `<routeKey>/<sourceId>`, server-rendering it when the snapshot holds its props. */
function renderFrameRoute(
  frames: FrameBundle,
  pathname: string,
  options: FrameServerOptions,
): FrameResult {
  const [routeKey, sourceId, ...rest] = pathname.slice(FRAME_ROUTE_PREFIX.length + 1).split("/");
  const entry = routeKey === undefined ? undefined : frames.registry.get(routeKey);
  if (entry === undefined || sourceId === undefined || sourceId.length === 0 || rest.length > 0) {
    throw new FrameRequestError(404, "Frame route not found.");
  }
  return {
    status: 200,
    headers: { "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8" },
    body: entry.render({
      sourceId,
      stream: options.stream ?? "/stream",
      modules: frames.modules,
      props: pageProps(options.snapshot?.(), sourceId),
    }),
  };
}

/** Creates a Fetch handler over a static frame bundle; a thin adapter over {@link resolveFrame}. */
export function createFrameRequestHandler(
  frames: FrameBundle,
  options: FrameServerOptions = {},
): FrameRequestHandler {
  return (request) => {
    const url = new URL(request.url);
    const frame = resolveFrame(frames, url.pathname + url.search, options);
    return frame === undefined
      ? undefined
      : new Response(frame.body, { status: frame.status, headers: frame.headers });
  };
}

/** Keeps a `</script>` sequence or HTML comment in embedded JSON from ending the inline script. */
function escapeScript(value: string): string {
  return value.replaceAll("<", "\\u003c");
}

class FrameRequestError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
