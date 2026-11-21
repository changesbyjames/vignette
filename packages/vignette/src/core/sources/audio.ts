import { z } from "zod";

import { defineSource } from "../define-source.js";

/**
 * A sound file asset, heard while a shown scene places it. `src` names a file in the project's
 * assets; `restartOnShow` restarts it whenever its scene becomes visible. It has no picture, so
 * its layer takes no space in the scene's layout.
 */
export const Audio = defineSource({
  kind: "audio",
  props: z.object({
    src: z.string().min(1),
    loop: z.boolean().default(false),
    restartOnShow: z.boolean().default(false),
  }),
  size: (_props, { canvas }) => canvas,
  assets: ["src"],
  media: () => ({ audio: true, video: false }),
});
