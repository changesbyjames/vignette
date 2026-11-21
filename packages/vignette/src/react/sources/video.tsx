import { useContext, useEffect, useState, type ReactNode } from "react";
import { z } from "zod";

import type { Video } from "../../core/sources/video.js";
import { useAsset } from "../assets.js";
import { AppearanceContext } from "../context.js";
import { useStreamEvents } from "../hooks.js";
import { useSourceMedia } from "../media.js";
import type { ReactSourcePlugin, ReactSourceViewProps } from "../plugin.js";

/**
 * `<Video>` as a `<video>` of the downloaded asset, its sound played through the stream's mixer;
 * suspends until it is downloaded.
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
  const { src: name, loop, restartOnShow } = source.props;
  const src = useAsset(name);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  useSourceMedia(source.id, { audio: video, video });
  useRestarts(source.id, video, restartOnShow);
  return (
    <video
      ref={setVideo}
      src={src}
      loop={loop}
      muted
      autoPlay
      playsInline
      preload="auto"
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}

/**
 * Rewinds `media` whenever its source enters the shown scene (with `restartOnShow`) and on a
 * `media:restart` event addressed to it or to no source.
 */
export function useRestarts(
  sourceId: string,
  media: HTMLMediaElement | null,
  restartOnShow: boolean,
): void {
  const appearances = useContext(AppearanceContext);
  useEffect(() => {
    if (restartOnShow) restart(media);
  }, [appearances, restartOnShow, media]);
  useStreamEvents((event) => {
    if (event.kind !== "media:restart") return;
    const { sourceId: addressed }: AddressedEvent = AddressedEventSchema.parse(event);
    if (addressed === undefined || addressed === sourceId) restart(media);
  });
}

/** Rewinds and plays; autoplay policy may refuse unmuted playback until the page is used. */
function restart(video: HTMLMediaElement | null): void {
  if (video === null) return;
  video.currentTime = 0;
  Promise.resolve()
    .then(async () => video.play())
    .catch(() => undefined);
}
