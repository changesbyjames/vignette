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
  clearMoqProps,
  registerMoqWatch,
  type MoqWatchElement,
} from "./watch.js";

/**
 * Renders `moq` sources in the DOM target as `<moq-watch>` drawing into a canvas, which the
 * target delays while the channel's sync offset is negative. The element plays its own sound
 * (see `applyMoqProps`).
 */
export const moqDom: DomSourcePlugin<typeof Moq> = {
  kind: "moq",
  load: registerMoqWatch,
  create(source, { document }) {
    const watch: MoqWatchElement = document.createElement("moq-watch");
    const canvas = appendMoqCanvas(watch);
    applyMoqProps(watch, source.props, source.audio !== undefined);
    return {
      element: watch,
      media: { video: canvas },
      update(next) {
        applyMoqProps(watch, next.props, next.audio !== undefined);
      },
      dispose() {
        clearMoqProps(watch);
        watch.remove();
      },
    };
  },
};
