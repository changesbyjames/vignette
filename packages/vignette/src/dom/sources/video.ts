import type { SourcePropsOf } from "../../core/define-source.js";
import type { Video } from "../../core/sources/video.js";
import type { PluginAssets } from "../../target/plugins.js";
import type { DomSourcePlugin } from "../plugin.js";

/**
 * `<Video>` as a `<video>` playing the downloaded asset. It keeps playing while its scene is
 * hidden; `restartOnShow` rewinds it each time it enters the shown scene, and a `media:restart`
 * event rewinds it on demand.
 */
export const videoDom: DomSourcePlugin<typeof Video> = {
  kind: "video",
  async create(source, { document, assets }) {
    const video = document.createElement("video");
    video.playsInline = true;
    video.autoplay = true;
    video.preload = "auto";
    let props = source.props;
    await applyVideo(video, props, assets);
    const restart = () => {
      video.currentTime = 0;
      play(video);
    };
    return {
      element: video,
      async update(next) {
        props = next.props;
        await applyVideo(video, props, assets);
      },
      activate() {
        if (props.restartOnShow) video.currentTime = 0;
        play(video);
      },
      event(event) {
        if (event.kind === "media:restart") restart();
      },
      dispose() {
        video.pause();
        video.removeAttribute("src");
        video.remove();
      },
    };
  },
};

async function applyVideo(
  video: HTMLVideoElement,
  props: SourcePropsOf<typeof Video>,
  assets: PluginAssets,
): Promise<void> {
  video.loop = props.loop;
  video.muted = props.muted;
  const src = await assets.resolve(props.src);
  if (video.src !== src) video.src = src;
}

/** Autoplay policy may refuse unmuted playback until the page is interacted with. */
function play(video: HTMLVideoElement): void {
  Promise.resolve()
    .then(async () => video.play())
    .catch(() => undefined);
}
