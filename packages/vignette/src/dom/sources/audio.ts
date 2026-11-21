import type { Audio } from "../../core/sources/audio.js";
import type { DomSourcePlugin } from "../plugin.js";
import { play } from "./video.js";

/**
 * `<Audio>` as an `<audio>` playing the downloaded asset, through the target's mixer. It has no
 * picture, so it waits in the hidden container. `restartOnShow` rewinds it each time its scene is
 * shown, and a `media:restart` event rewinds it on demand.
 */
export const audioDom: DomSourcePlugin<typeof Audio> = {
  kind: "audio",
  async create(source, { document, assets }) {
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.preload = "auto";
    audio.muted = true;
    let props = source.props;
    const apply = async () => {
      audio.loop = props.loop;
      const src = await assets.resolve(props.src);
      if (audio.src !== src) audio.src = src;
    };
    await apply();
    return {
      element: audio,
      media: { audio },
      async update(next) {
        props = next.props;
        await apply();
      },
      activate() {
        if (props.restartOnShow) audio.currentTime = 0;
        play(audio);
      },
      event(event) {
        if (event.kind !== "media:restart") return;
        audio.currentTime = 0;
        play(audio);
      },
      dispose() {
        audio.pause();
        audio.removeAttribute("src");
        audio.remove();
      },
    };
  },
};
