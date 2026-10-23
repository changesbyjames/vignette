import { BrowserView, type BrowserViewProps } from "@strangecyan/vignette";
import { createElement, type ReactElement } from "react";

import type { FrameDefinition, FrameMetadata } from "./definition.js";
import { toFrameProps } from "./serialization.js";

/** Path prefix of every frame page: `/__vignette/frame/<routeKey>/<sourceId>`. */
export const FRAME_ROUTE_PREFIX = "/__vignette/frame";

/** The stable, root-relative page URL of one frame placement. */
export function frameUrl(metadata: FrameMetadata, sourceId: string): string {
  return `${FRAME_ROUTE_PREFIX}/${metadata.routeKey}/${sourceId}`;
}

interface ViewPlacementProps<Params extends object> extends Omit<
  BrowserViewProps,
  "sourceId" | "url" | "props"
> {
  readonly source: FrameDefinition<Params>;
}

interface ViewRequiredParams<Params extends object> {
  readonly params: NoInfer<Params>;
}

interface ViewOptionalParams<Params extends object> {
  readonly params?: NoInfer<Params> | undefined;
}

/**
 * Props for placing a typed React frame. `id` names both the layer and its browser source.
 * `params` is optional when the frame has no required parameters, and `viewport` defaults to the
 * laid-out size of the placement.
 */
export type ViewProps<Params extends object> = ViewPlacementProps<Params> &
  (Record<never, never> extends Params ? ViewOptionalParams<Params> : ViewRequiredParams<Params>);

/**
 * Declares and places a typed React frame as a browser source. The page URL depends only on the
 * frame and `id`, so it never changes. `params` are validated here and travel as live page props
 * in each snapshot: changing them re-renders the frame in place without reloading it.
 */
export function View<Params extends object>(props: ViewProps<Params>): ReactElement {
  const { source, params, ...placement } =
    /* SAFETY: Both ViewProps branches carry `params` as Params, optional only when empty params are valid. */ props as ViewPlacementProps<Params> &
      ViewOptionalParams<Params>;
  const metadata = source.metadata;
  if (metadata === undefined) {
    throw new Error(
      "The frame definition has no client metadata. Export it from a module processed by vignette().",
    );
  }
  return createElement(BrowserView, {
    ...placement,
    url: frameUrl(metadata, placement.id),
    props: toFrameProps(source.params.parse(params ?? {})),
  });
}
