import type { DomSourceRenderer } from "./types.js";

export const colorRenderer: DomSourceRenderer<"source:color"> = {
  kind: "source:color",
  create(document) {
    const element = document.createElement("div");
    return {
      element,
      update(source) {
        if (source.kind !== "source:color")
          throw new TypeError("Color renderer received another source kind.");
        element.style.backgroundColor = source.color;
      },
      dispose() {
        element.remove();
      },
    };
  },
};
