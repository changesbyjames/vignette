import { useContext, useEffect, useRef, type ReactNode } from "react";
import { z } from "zod";

import type { Video } from "../../core/sources/video.js";
import { useAsset } from "../assets.js";
import { AppearanceContext } from "../context.js";
import { useStreamEvents } from "../hooks.js";
import type { ReactSourcePlugin, ReactSourceViewProps } from "../plugin.js";

/**
 * `<Video>` as a `<video>` of the downloaded asset; suspends until it is downloaded.
 * `restartOnShow` rewinds it whenever its layer enters the shown scene, and a `media:restart` event
 * addressed to it (or to no source) rewinds it on demand.
 */
export const VideoView: ReactSourcePlugin<typeof Video> = {
  kind: "video",
  View: VideoSource,
};

/** The optional source address of a show event. */
const AddressedEventSchema = z.looseObject({ sourceId: z.string().optional() });
/** The optional source address of a show event. */
type AddressedEvent = z.output<typeof AddressedEventSchema>;

function VideoSource({ source }: ReactSourceViewProps<typeof Video>): ReactNode {
  const { src: name, loop, muted, restartOnShow } = source.props;
  const src = useAsset(name);
  const video = useRef<HTMLVideoElement>(null);
  const appearances = useContext(AppearanceContext);
  useEffect(() => {
    if (restartOnShow) restart(video.current);
  }, [appearances, restartOnShow]);
  useStreamEvents((event) => {
    if (event.kind !== "media:restart") return;
    const { sourceId }: AddressedEvent = AddressedEventSchema.parse(event);
    if (sourceId === undefined || sourceId === source.id) restart(video.current);
  });
  return (
    <video
      ref={video}
      src={src}
      loop={loop}
      muted={muted}
      autoPlay
      playsInline
      preload="auto"
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}

/** Rewinds and plays; autoplay policy may refuse unmuted playback until the page is used. */
function restart(video: HTMLVideoElement | null): void {
  if (video === null) return;
  video.currentTime = 0;
  Promise.resolve()
    .then(async () => video.play())
    .catch(() => undefined);
}
