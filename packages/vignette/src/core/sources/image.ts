import { z } from "zod";

import { defineSource } from "../define-source.js";
import { ContentSizeSchema } from "../geometry.js";

/**
 * An image asset. `src` names a file in the project's assets; declare `size` for `contain` or
 * `cover` to fit by the image's real proportions, otherwise it takes its layer's size.
 */
export const Image = defineSource({
  kind: "image",
  props: z.object({ src: z.string().min(1), size: ContentSizeSchema.optional() }),
  size: (props, { canvas, layer }) => props.size ?? layer ?? canvas,
  assets: ["src"],
});
