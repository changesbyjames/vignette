import { z } from "zod";

import { defineSource } from "../define-source.js";
import { ContentSizeSchema } from "../geometry.js";

/** A web page. Its viewport defaults to its layer's size, or the canvas for a shared source. */
export const Browser = defineSource({
  kind: "browser",
  props: z.object({
    url: z.url({ protocol: /^https?$/u }),
    viewport: ContentSizeSchema.optional(),
    shutdownWhenHidden: z.boolean().default(false),
  }),
  size: (props, { canvas, layer }) => props.viewport ?? layer ?? canvas,
});
