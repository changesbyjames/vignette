/**
 * The `moq` kind for `vignette/dom`: a `<moq-watch>` element from `@moq/watch`.
 *
 * ```ts
 * domTarget(element, { sources: [moqDom] });
 * ```
 *
 * @module
 */
import type { DomSourcePlugin } from "vignette/dom";

import type { Moq } from "./index.js";
import {
  appendMoqCanvas,
  applyMoqProps,
  clearMoqProps,
  registerMoqWatch,
  type MoqWatchElement,
} from "./watch.js";

/** Renders `moq` sources in the DOM target as `<moq-watch>` drawing into a canvas. */
export const moqDom: DomSourcePlugin<typeof Moq> = {
  kind: "moq",
  load: registerMoqWatch,
  create(source, { document }) {
    const watch: MoqWatchElement = document.createElement("moq-watch");
    appendMoqCanvas(watch);
    applyMoqProps(watch, source.props);
    return {
      element: watch,
      update(next) {
        applyMoqProps(watch, next.props);
      },
      dispose() {
        clearMoqProps(watch);
        watch.remove();
      },
    };
  },
};
