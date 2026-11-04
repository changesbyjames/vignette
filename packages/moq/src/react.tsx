/**
 * The `moq` kind for `@strangecyan/vignette/react`: a `<moq-watch>` element from `@moq/watch`, loaded on first
 * use. Suspends until the element is registered.
 *
 * ```tsx
 * <Stream url="/stream" sources={[MoqView]}>
 * ```
 *
 * @module
 */
import { createElement, use, useLayoutEffect, useRef, type ReactNode } from "react";
import type { ReactSourcePlugin, ReactSourceViewProps } from "@strangecyan/vignette/react";

import type { Moq } from "./index.js";
import {
  appendMoqCanvas,
  applyMoqProps,
  clearMoqProps,
  registerMoqWatch,
  type MoqWatchElement,
} from "./watch.js";

/** Renders `moq` sources in `<Stream>` as `<moq-watch>` drawing into a canvas. */
export const MoqView: ReactSourcePlugin<typeof Moq> = {
  kind: "moq",
  View: MoqWatchView,
};

/** Registration starts on the first render and is shared by every view. */
let registered: Promise<void> | undefined = undefined;

function MoqWatchView({ source }: ReactSourceViewProps<typeof Moq>): ReactNode {
  registered ??= registerMoqWatch();
  use(registered);
  const watch = useRef<MoqWatchElement>(null);
  useLayoutEffect(() => {
    const element = watch.current;
    if (element === null) return undefined;
    appendMoqCanvas(element);
    return () => {
      clearMoqProps(element);
      element.replaceChildren();
    };
  }, []);
  useLayoutEffect(() => {
    if (watch.current !== null) applyMoqProps(watch.current, source.props);
  }, [source.props]);
  return createElement("moq-watch", {
    ref: watch,
    style: { display: "block", width: "100%", height: "100%" },
  });
}
