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
import { createElement, use, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  useSourceMedia,
  type ReactSourcePlugin,
  type ReactSourceViewProps,
} from "@strangecyan/vignette/react";

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

/**
 * Mounts `<moq-watch>` with its canvas once, maps props onto it on every change, and hands the
 * canvas to the stream's media, which delays it while the channel's sync offset is negative. The
 * element plays its own sound (see `applyMoqProps`).
 */
function MoqWatchView({ source }: ReactSourceViewProps<typeof Moq>): ReactNode {
  registered ??= registerMoqWatch();
  use(registered);
  const watch = useRef<MoqWatchElement>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | undefined>(undefined);
  useLayoutEffect(() => {
    const element = watch.current;
    if (element === null) return undefined;
    setCanvas(appendMoqCanvas(element));
    return () => {
      clearMoqProps(element);
      element.replaceChildren();
    };
  }, []);
  const heard = source.audio !== undefined;
  useLayoutEffect(() => {
    if (watch.current !== null) applyMoqProps(watch.current, source.props, heard);
  }, [source.props, heard]);
  useSourceMedia(source.id, { video: canvas });
  return createElement("moq-watch", {
    ref: watch,
    style: { display: "block", width: "100%", height: "100%" },
  });
}
