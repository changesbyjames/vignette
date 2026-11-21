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
  bridgeMoqAudio,
  clearMoqProps,
  registerMoqWatch,
  type MoqAudioBridge,
  type MoqWatchElement,
} from "./watch.js";

/** Renders `moq` sources in `<Stream>` as `<moq-watch>` drawing into a canvas. */
export const MoqView: ReactSourcePlugin<typeof Moq> = {
  kind: "moq",
  View: MoqWatchView,
};

/** What a mounted view plays and shows. */
interface MoqMedia {
  readonly canvas: HTMLCanvasElement;
  readonly audio: MoqAudioBridge | undefined;
}

/** Registration starts on the first render and is shared by every view. */
let registered: Promise<void> | undefined = undefined;

/**
 * Mounts `<moq-watch>` with its canvas and audio bridge once, maps props onto it on every
 * change, and hands the bridge's stream and the canvas to the stream's mixer.
 */
function MoqWatchView({ source }: ReactSourceViewProps<typeof Moq>): ReactNode {
  registered ??= registerMoqWatch();
  use(registered);
  const watch = useRef<MoqWatchElement>(null);
  const [media, setMedia] = useState<MoqMedia | undefined>(undefined);
  useLayoutEffect(() => {
    const element = watch.current;
    if (element === null) return undefined;
    const canvas = appendMoqCanvas(element);
    const audio = "MediaStream" in globalThis ? bridgeMoqAudio(element) : undefined;
    setMedia({ canvas, audio });
    return () => {
      audio?.dispose();
      clearMoqProps(element);
      element.replaceChildren();
    };
  }, []);
  const heard = source.audio !== undefined;
  useLayoutEffect(() => {
    if (watch.current !== null) applyMoqProps(watch.current, source.props, heard);
  }, [source.props, heard]);
  useSourceMedia(source.id, { audio: media?.audio?.stream, video: media?.canvas });
  return createElement("moq-watch", {
    ref: watch,
    style: { display: "block", width: "100%", height: "100%" },
  });
}
