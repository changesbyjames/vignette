import type { Image } from "../../core/sources/image.js";
import type { ObsSourcePlugin } from "../plugin.js";

/** `<Image>` as an `image_source` reading the downloaded asset file. */
export const imageObs: ObsSourcePlugin<typeof Image> = {
  kind: "image",
  async create(source, { assets }) {
    const file = await assets.resolve(source.props.src);
    return { input: { kind: "image_source", settings: { file, unload: false } } };
  },
};
