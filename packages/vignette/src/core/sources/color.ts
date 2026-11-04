import { z } from "zod";

import { defineSource } from "../define-source.js";
import { ContentSizeSchema } from "../geometry.js";

/** A solid fill. `color` is `#rrggbb` or `#rrggbbaa`; its size defaults to the canvas. */
export const Color = defineSource({
  kind: "color",
  props: z.object({
    color: z.string().regex(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu, "Use #rrggbb or #rrggbbaa."),
    size: ContentSizeSchema.optional(),
  }),
  size: (props, { canvas }) => props.size ?? canvas,
});
