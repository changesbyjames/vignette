import type { Color } from "../../core/sources/color.js";
import type { DomSourcePlugin } from "../plugin.js";

/** `<Color>` as a filled div. */
export const colorDom: DomSourcePlugin<typeof Color> = {
  kind: "color",
  create(source, { document }) {
    const element = document.createElement("div");
    element.style.background = source.props.color;
    return {
      element,
      update(next) {
        element.style.background = next.props.color;
      },
      dispose() {
        element.remove();
      },
    };
  },
};
