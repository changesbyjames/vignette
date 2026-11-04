import type { Image } from "../../core/sources/image.js";
import type { DomSourcePlugin } from "../plugin.js";

/** `<Image>` as an `<img>` showing the downloaded asset's object URL. */
export const imageDom: DomSourcePlugin<typeof Image> = {
  kind: "image",
  async create(source, { document, assets }) {
    const image = document.createElement("img");
    image.alt = "";
    image.draggable = false;
    image.src = await assets.resolve(source.props.src);
    return {
      element: image,
      async update(next) {
        const src = await assets.resolve(next.props.src);
        if (image.src !== src) image.src = src;
      },
      dispose() {
        image.removeAttribute("src");
        image.remove();
      },
    };
  },
};
