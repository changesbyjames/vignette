import { BrowserView, type BrowserViewProps } from "@strangecyan/vignette";
import { createElement, type ReactElement } from "react";

import type { FrameDefinition } from "./definition.js";
import { hashFrameValue, serializeFrameParams } from "./serialization.js";

export const FRAME_ROUTE_PREFIX = "/__vignette/frame";

interface ViewPlacementProps<Params extends object> extends Omit<
  BrowserViewProps,
  "id" | "sourceId" | "url"
> {
  readonly source: FrameDefinition<Params>;
  /** Identity prefix for the layer and source IDs; defaults to one derived from the params. */
  readonly id?: string | undefined;
}

interface ViewRequiredParams<Params extends object> {
  readonly params: NoInfer<Params>;
}

interface ViewOptionalParams<Params extends object> {
  readonly params?: NoInfer<Params> | undefined;
}

/**
 * Props for placing a typed React frame as a browser source. `params` is optional when the frame
 * has no required parameters (for example a frame defined without a `params` schema), and
 * `viewport` defaults to the laid-out size of the placement.
 */
export type ViewProps<Params extends object> = ViewPlacementProps<Params> &
  (Record<never, never> extends Params ? ViewOptionalParams<Params> : ViewRequiredParams<Params>);

/**
 * Declares and places a typed, parameterized React DOM frame. The browser source URL is
 * root-relative (`/__vignette/frame/<routeKey>?props=...`); each target resolves it against its
 * own base URL, so the composer never needs to know its public origin.
 */
export function View<Params extends object>(props: ViewProps<Params>): ReactElement {
  const { source, params, id, ...placement } =
    /* SAFETY: Both ViewProps branches carry `params` as Params, optional only when empty params are valid. */ props as ViewPlacementProps<Params> &
      ViewOptionalParams<Params>;
  const metadata = source.metadata;
  if (metadata === undefined) {
    throw new Error(
      "The frame definition has no client metadata. Export it from a module processed by vignette().",
    );
  }
  const parsed = source.params.parse(params ?? {});
  const serialized = serializeFrameParams(parsed);
  const identity = id ?? `frame.${metadata.routeKey}.${hashFrameValue(serialized)}`;
  return createElement(BrowserView, {
    ...placement,
    id: `${identity}.layer`,
    sourceId: `${identity}.source`,
    url: `${FRAME_ROUTE_PREFIX}/${metadata.routeKey}?props=${encodeURIComponent(serialized)}`,
  });
}
