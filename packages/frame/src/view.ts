import { layerId, sourceId, type Size } from "@cbj/vignette-core";
import { BrowserView, type BrowserViewProps } from "@cbj/vignette";
import { createElement, useContext, type ReactElement } from "react";

import type { FrameDefinition } from "./definition.js";
import { SceneContext } from "./scene.js";
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

/** Declares and places a typed, parameterized React DOM frame. */
export function View<Params extends object>(props: ViewProps<Params>): ReactElement {
  const scene = useContext(SceneContext);
  if (scene === undefined) throw new Error("<View> must be rendered inside a <SceneProvider>.");
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
    id: layerId(`${identity}.layer`),
    sourceId: sourceId(`${identity}.source`),
    url: `${scene.origin}${FRAME_ROUTE_PREFIX}/${metadata.routeKey}?props=${encodeURIComponent(serialized)}`,
    viewport: props.viewport ?? DEFAULT_VIEWPORT,
    ...(props.label === undefined ? {} : { label: props.label }),
    ...(props.shutdownWhenHidden === undefined
      ? {}
      : { shutdownWhenHidden: props.shutdownWhenHidden }),
    ...(props.style === undefined ? {} : { style: props.style }),
    ...(props.fit === undefined ? {} : { fit: props.fit }),
    ...(props.alignment === undefined ? {} : { alignment: props.alignment }),
    ...(props.crop === undefined ? {} : { crop: props.crop }),
    ...(props.visible === undefined ? {} : { visible: props.visible }),
    ...(props.opacity === undefined ? {} : { opacity: props.opacity }),
    ...(props.rotation === undefined ? {} : { rotation: props.rotation }),
  });
}
