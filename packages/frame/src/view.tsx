import { layerId, sourceId, type Size } from "@cbj/vignette-core";
import { BrowserView, type BrowserViewProps } from "@cbj/vignette";
import { createContext, createElement, useContext, type ReactElement, type ReactNode } from "react";

import type { FrameDefinition } from "./definition.js";
import { hashFrameValue, serializeFrameParams } from "./serialization.js";

export const FRAME_ROUTE_PREFIX = "/__vignette/frame";
const DEFAULT_VIEWPORT: Size = { width: 1920, height: 1080 };
const FrameOriginContext = createContext<string | undefined>(undefined);
const FrameRegistrarContext = createContext<FrameRegistrar | undefined>(undefined);

export interface FrameProviderProps {
  readonly origin: string;
  readonly children?: ReactNode;
}

export function FrameProvider(props: FrameProviderProps): ReactElement {
  return createElement(FrameOriginContext.Provider, {
    value: normalizeOrigin(props.origin),
    children: props.children,
  });
}

/** Receives every frame definition placed by a `<View>` under the provider. */
export type FrameRegistrar = <Params extends object>(definition: FrameDefinition<Params>) => void;

export interface FrameRegistrarProviderProps {
  readonly register: FrameRegistrar;
  readonly children?: ReactNode;
}

/**
 * Hosts wrap the scene with this provider so placed frames register their routes without any
 * out-of-band module lists. Registration happens during render; registrars must be idempotent.
 */
export function FrameRegistrarProvider(props: FrameRegistrarProviderProps): ReactElement {
  return createElement(FrameRegistrarContext.Provider, {
    value: props.register,
    children: props.children,
  });
}

export interface ViewProps<Params extends object> extends Omit<
  BrowserViewProps,
  "id" | "sourceId" | "url" | "viewport"
> {
  readonly source: FrameDefinition<Params>;
  readonly params: NoInfer<Params>;
  readonly id?: string;
  readonly viewport?: Size;
}

export function View<Params extends object>(props: ViewProps<Params>): ReactElement {
  const origin = useContext(FrameOriginContext);
  if (origin === undefined) throw new Error("<View> must be rendered inside a <FrameProvider>.");
  const metadata = props.source.metadata;
  if (metadata === undefined) {
    throw new Error(
      "The frame definition has no client metadata. Export it from a module processed by vignetteFrames().",
    );
  }
  // Render-time registration is deliberate: it is idempotent, and it guarantees the route exists
  // before any snapshot containing this frame's URL is published to a runtime.
  useContext(FrameRegistrarContext)?.(props.source);
  const parsed = props.source.params.parse(props.params);
  const serialized = serializeFrameParams(parsed);
  const identity = props.id ?? `frame.${metadata.routeKey}.${hashFrameValue(serialized)}`;
  return createElement(BrowserView, {
    id: layerId(`${identity}.layer`),
    sourceId: sourceId(`${identity}.source`),
    url: `${origin}${FRAME_ROUTE_PREFIX}/${metadata.routeKey}?props=${encodeURIComponent(serialized)}`,
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

function normalizeOrigin(origin: string): string {
  const parsed = new URL(origin);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("Frame origin must use HTTP(S).");
  }
  if (parsed.pathname !== "/" || parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new TypeError("Frame origin must not contain a path, query, or fragment.");
  }
  return parsed.origin;
}
