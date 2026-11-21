import { z } from "zod";

import { defineSource } from "../define-source.js";
import { ContentSizeSchema } from "../geometry.js";

/**
 * A media file asset. `src` names a file in the project's assets; `restartOnShow` restarts it
 * whenever its scene becomes visible. Its size defaults to its layer's size. Its sound is its
 * `audio` channel; `audio={false}` silences it.
 */
export const Video = defineSource({
  kind: "video",
  props: z.object({
    src: z.string().min(1),
    size: ContentSizeSchema.optional(),
    loop: z.boolean().default(false),
    restartOnShow: z.boolean().default(false),
  }),
  size: (props, { canvas, layer }) => props.size ?? layer ?? canvas,
  assets: ["src"],
  media: () => ({ audio: true, video: true }),
});
