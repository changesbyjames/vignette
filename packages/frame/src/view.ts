import { omitUndefined } from "@strangecyan/vignette-core";
import type { Size } from "@strangecyan/vignette-core";
import { BrowserView, type BrowserViewProps } from "@strangecyan/vignette";
import { createElement, type ReactElement } from "react";

import type { FrameDefinition } from "./definition.js";
import { hashFrameValue, serializeFrameParams } from "./serialization.js";

export const FRAME_ROUTE_PREFIX = "/__vignette/frame";
const DEFAULT_VIEWPORT: Size = { width: 1920, height: 1080 };

/** Props for placing a typed React frame as a browser source. */
export interface ViewProps<Params extends object> extends Omit<
  BrowserViewProps,
  "id" | "sourceId" | "url" | "viewport"
> {
  readonly source: FrameDefinition<Params>;
  readonly params: NoInfer<Params>;
  readonly id?: string;
  readonly viewport?: Size;
}

/**
 * Declares and places a typed, parameterized React DOM frame. The browser source URL is
 * root-relative (`/__vignette/frame/<routeKey>?props=...`); each target resolves it against its
 * own base URL, so the composer never needs to know its public origin.
 */
export function View<Params extends object>(props: ViewProps<Params>): ReactElement {
  const metadata = props.source.metadata;
  if (metadata === undefined) {
    throw new Error(
      "The frame definition has no client metadata. Export it from a module processed by vignette().",
    );
  }
  const parsed = props.source.params.parse(props.params);
  const serialized = serializeFrameParams(parsed);
  const identity = props.id ?? `frame.${metadata.routeKey}.${hashFrameValue(serialized)}`;
  return createElement(BrowserView, {
    id: `${identity}.layer`,
    sourceId: `${identity}.source`,
    url: `${FRAME_ROUTE_PREFIX}/${metadata.routeKey}?props=${encodeURIComponent(serialized)}`,
    viewport: props.viewport ?? DEFAULT_VIEWPORT,
    ...omitUndefined({ label: props.label }),
    ...omitUndefined({ shutdownWhenHidden: props.shutdownWhenHidden }),
    ...omitUndefined({ style: props.style }),
    ...omitUndefined({ fit: props.fit }),
    ...omitUndefined({ alignment: props.alignment }),
    ...omitUndefined({ crop: props.crop }),
    ...omitUndefined({ visible: props.visible }),
    ...omitUndefined({ opacity: props.opacity }),
    ...omitUndefined({ rotation: props.rotation }),
  });
}
