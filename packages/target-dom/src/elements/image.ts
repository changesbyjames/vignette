import type { ImageSource } from "@strangecyan/vignette-core";

import type { DomSourceRenderer } from "./types.js";

/** Built-in image element renderer for resolved image assets. */
export const imageRenderer: DomSourceRenderer<ImageSource> = {
  kind: "source:image",
  create(document) {
    const image = document.createElement("img");
    image.alt = "";
    image.draggable = false;
    image.decoding = "async";

    return {
      element: image,
      update(source, _item, resolvedUrl) {
        if (source.kind !== "source:image")
          throw new TypeError("Image renderer received another source kind.");
        if (resolvedUrl === undefined) throw new TypeError("Image source requires a resolved URL.");
        if (image.src !== resolvedUrl) image.src = resolvedUrl;
      },
      dispose() {
        image.removeAttribute("src");
      },
    };
  },
};
