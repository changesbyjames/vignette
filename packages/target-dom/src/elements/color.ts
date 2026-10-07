import type { ColorSource } from "@strangecyan/vignette-core";

import type { DomSourceRenderer } from "./types.js";

/** Built-in element renderer for solid color sources. */
export const colorRenderer: DomSourceRenderer<ColorSource> = {
  kind: "source:color",
  create(document) {
    const element = document.createElement("div");
    return {
      element,
      update(source) {
        if (source.kind !== "source:color")
          throw new TypeError("Color renderer received another source kind.");
        element.style.backgroundColor =
          /* SAFETY: The source registry selects this module by its source kind after core validation of that definition. */ (
            source as ColorSource
          ).color;
      },
      dispose() {
        element.remove();
      },
    };
  },
};
