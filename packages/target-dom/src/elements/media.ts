import type { MediaFileSource } from "@strangecyan/vignette-core";

import type { DomSourceRenderer } from "./types.js";

/** Built-in video element renderer for resolved media assets. */
export const mediaRenderer: DomSourceRenderer<MediaFileSource> = {
  kind: "source:media-file",
  create(document) {
    const video = document.createElement("video");
    let restartOnActivate = true;
    video.playsInline = true;
    video.preload = "auto";
    video.autoplay = true;

    return {
      element: video,
      update(source, _item, resolvedUrl) {
        if (source.kind !== "source:media-file") {
          throw new TypeError("Media renderer received another source kind.");
        }
        const definition = source as MediaFileSource;
        if (resolvedUrl === undefined) throw new TypeError("Media source requires a resolved URL.");
        if (video.src !== resolvedUrl) video.src = resolvedUrl;
        video.loop = definition.loop ?? false;
        video.muted = definition.muted ?? true;
        video.playbackRate = definition.playbackRate ?? 1;
        // Preserve the DOM target's historical restart behavior when omitted.
        restartOnActivate = definition.restartOnActivate ?? true;
      },
      activate() {
        if (restartOnActivate) video.currentTime = 0;
        void video.play().catch(() => {
          // Autoplay policy can still require user interaction for unmuted media.
        });
      },
      dispose() {
        video.pause();
        video.removeAttribute("src");
        video.load();
      },
    };
  },
};
