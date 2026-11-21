import { useState, type ReactNode } from "react";

import type { Audio } from "../../core/sources/audio.js";
import { useAsset } from "../assets.js";
import { useSourceMedia } from "../media.js";
import type { ReactSourcePlugin, ReactSourceViewProps } from "../plugin.js";
import { useRestarts } from "./video.js";

/**
 * `<Audio>` as an `<audio>` of the downloaded asset, played through the stream's mixer while a
 * stage shows one of its scenes; suspends until it is downloaded. `restartOnShow` rewinds it
 * whenever a stage starts hearing it, and a `media:restart` event rewinds it on demand.
 */
export const AudioView: ReactSourcePlugin<typeof Audio> = {
  kind: "audio",
  View: AudioSource,
};

function AudioSource({ source }: ReactSourceViewProps<typeof Audio>): ReactNode {
  const { src: name, loop, restartOnShow } = source.props;
  const src = useAsset(name);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  useSourceMedia(source.id, { audio });
  useRestarts(source.id, audio, restartOnShow);
  return <audio ref={setAudio} src={src} loop={loop} muted autoPlay preload="auto" />;
}
