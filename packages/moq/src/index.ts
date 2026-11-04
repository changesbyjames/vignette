/**
 * The `moq` source kind: one Media over QUIC broadcast rendered as video. This entry is the
 * definition only; `@vignette/moq/react`, `/dom` and `/obs` hold one plugin per target.
 *
 * @module
 */
import { ContentSizeSchema, defineSource } from "@strangecyan/vignette";
import { z } from "zod";

/**
 * One Media over QUIC broadcast. `size` is the broadcast's resolution, used for `fit`.
 *
 * ```tsx
 * <Moq id="camera" url="https://cdn.moq.dev/demo" broadcast="bbb.hang" size={{ width: 1280, height: 720 }} />
 * ```
 */
export const Moq = defineSource({
  kind: "moq",
  props: z.object({
    /** The relay. */
    url: z.url({ protocol: /^https?$/u }),
    /** The broadcast's path on the relay. */
    broadcast: z.string().regex(/\S/u, "Name a broadcast."),
    size: ContentSizeSchema,
    /** Target end-to-end latency. */
    latencyMs: z.number().int().min(0).max(30_000).default(100),
    /** Render the video track. */
    video: z.boolean().default(true),
    /** Play the audio track. */
    audio: z.boolean().default(true),
    /** A rendition name, or `auto` to let the player choose. */
    quality: z.string().regex(/\S/u, "Use 'auto' or a rendition name.").default("auto"),
    /** Stop downloading video while the source is off screen. */
    disableWhenHidden: z.boolean().default(true),
  }),
  size: (props) => props.size,
});
