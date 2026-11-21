/**
 * The `moq` kind for `@strangecyan/vignette/dom`: a `<moq-watch>` element from `@moq/watch`.
 *
 * ```ts
 * domTarget(element, { sources: [moqDom] });
 * ```
 *
 * @module
 */
import type { DomSourcePlugin } from "@strangecyan/vignette/dom";

import type { Moq } from "./index.js";
import {
  appendMoqCanvas,
  applyMoqProps,
  bridgeMoqAudio,
  clearMoqProps,
  registerMoqWatch,
  type MoqWatchElement,
} from "./watch.js";

/**
 * Renders `moq` sources in the DOM target as `<moq-watch>` drawing into a canvas, its sound
 * played through the target's mixer.
 */
export const moqDom: DomSourcePlugin<typeof Moq> = {
  kind: "moq",
  load: registerMoqWatch,
  create(source, { document }) {
    const watch: MoqWatchElement = document.createElement("moq-watch");
    const canvas = appendMoqCanvas(watch);
    applyMoqProps(watch, source.props, source.audio !== undefined);
    const audio = "MediaStream" in globalThis ? bridgeMoqAudio(watch) : undefined;
    return {
      element: watch,
      media: { audio: audio?.stream, video: canvas },
      update(next) {
        applyMoqProps(watch, next.props, next.audio !== undefined);
      },
      dispose() {
        audio?.dispose();
        clearMoqProps(watch);
        watch.remove();
      },
    };
  },
};
