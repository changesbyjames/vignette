/**
 * Browser entrypoint that mounts a Vignette frame and keeps it in step with its live props.
 *
 * @module
 */
import { createElement, useSyncExternalStore, type ReactElement } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

import type { FrameDefinition } from "./definition.js";
import { frameElement } from "./frame-element.js";
import { pageProps } from "./page-props.js";
import {
  FrameJsonValueSchema,
  type FrameJsonObject,
  type FrameJsonValue,
} from "./serialization.js";
import { subscribeSharedEvent } from "./shared-stream.js";

/** Which placement a frame page renders and where it reads that placement's props. */
export interface FrameMountOptions {
  /** The browser source ID, which is also the `<View>` `id`. */
  readonly sourceId: string;
  /** Composer stream URL. */
  readonly stream: string;
  /** Props the server rendered the page with; the page hydrates with them. */
  readonly initialProps?: FrameJsonObject;
}

interface LiveFrameProps<Params extends object> {
  readonly definition: FrameDefinition<Params>;
  readonly params: ParamsStore<Params>;
  readonly serverParams: Params | undefined;
}

/**
 * Mounts a frame into its page and re-renders it whenever its props change in a streamed snapshot.
 * Without initial props the page stays empty until the first snapshot arrives. Returns a function
 * that stops following the stream and unmounts the frame.
 */
export function mountFrame<Params extends object>(
  definition: FrameDefinition<Params>,
  options: FrameMountOptions,
): () => void {
  const container = document.querySelector<HTMLElement>("[data-vignette-frame-root]");
  if (container === null) throw new Error("Frame document is missing its root element.");
  const serverParams =
    options.initialProps === undefined ? undefined : definition.params.parse(options.initialProps);
  const params = new ParamsStore(serverParams, options.initialProps);
  const element = createElement(LiveFrame<Params>, { definition, params, serverParams });
  const root = serverParams === undefined ? createRoot(container) : hydrateRoot(container, element);
  if (serverParams === undefined) root.render(element);

  const unsubscribe = subscribeSharedEvent(options.stream, "update", (data) => {
    const props = pageProps(parseJson(data), options.sourceId);
    if (props === undefined) return;
    try {
      params.set(props, definition.params.parse(props));
    } catch (cause) {
      // Keep the last valid render; the composer validated these props, so this is drift.
      console.error(cause);
    }
  });

  return () => {
    unsubscribe();
    root.unmount();
  };
}

/**
 * Renders the frame with the latest params. Hydration uses the server's params, so markup always
 * matches; React then applies any newer params as an ordinary update.
 */
function LiveFrame<Params extends object>(props: LiveFrameProps<Params>): ReactElement | null {
  const params = useSyncExternalStore(
    props.params.subscribe,
    props.params.getSnapshot,
    () => props.serverParams,
  );
  return params === undefined ? null : frameElement(props.definition, params);
}

/** The latest parsed params, replaced only when the raw props actually change. */
class ParamsStore<Params extends object> {
  private readonly listeners = new Set<() => void>();
  private params: Params | undefined;
  private key: string | undefined;

  constructor(params: Params | undefined, props: FrameJsonObject | undefined) {
    this.params = params;
    this.key = props === undefined ? undefined : JSON.stringify(props);
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): Params | undefined => this.params;

  set(props: FrameJsonObject, params: Params): void {
    const key = JSON.stringify(props);
    if (key === this.key) return;
    this.key = key;
    this.params = params;
    for (const listener of this.listeners) listener();
  }
}

function parseJson(data: string): FrameJsonValue | undefined {
  try {
    return FrameJsonValueSchema.parse(JSON.parse(data));
  } catch {
    return undefined;
  }
}
