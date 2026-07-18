import type { MediaFileSource } from "@strangecyan/vignette-core";

import { selectInputKind, type ObsSourceCodec } from "./types.js";

/** Built-in OBS media-source codec. */
export const mediaCodec: ObsSourceCodec<MediaFileSource> = {
  kind: "source:media-file",
  inputKinds: ["ffmpeg_source"],
  compile(source, context) {
    const inputKind = selectInputKind(this.inputKinds, context.availableInputKinds);
    if (inputKind === undefined) {
      return { supported: false, reason: "OBS FFmpeg media input kind is unavailable." };
    }
    if (context.resolvedAsset === undefined) {
      return { supported: false, reason: `Media source '${source.id}' has no resolved OBS asset.` };
    }
    return {
      supported: true,
      inputKind,
      settings: {
        is_local_file: true,
        local_file: context.resolvedAsset,
        looping: source.loop ?? false,
        restart_on_activate: source.restartOnActivate ?? false,
      },
    };
  },
};
