import type { Video } from "../../core/sources/video.js";
import type { ObsSourcePlugin } from "../plugin.js";

/**
 * `<Video>` as an `ffmpeg_source` playing the downloaded asset file. `restartOnShow` restarts it
 * whenever its scene item becomes active, and a `media:restart` event restarts it on demand.
 */
export const videoObs: ObsSourcePlugin<typeof Video> = {
  kind: "video",
  async create(source, context) {
    const file = await context.assets.resolve(source.props.src);
    return {
      input: {
        kind: "ffmpeg_source",
        settings: {
          is_local_file: true,
          local_file: file,
          looping: source.props.loop,
          restart_on_activate: source.props.restartOnShow,
        },
        muted: source.props.muted,
      },
      async event(event) {
        if (event.kind !== "media:restart") return;
        await context.request(source.id, "TriggerMediaInputAction", {
          mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
        });
      },
    };
  },
};
