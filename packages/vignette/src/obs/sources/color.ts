import type { Color } from "../../core/sources/color.js";
import type { ObsSourcePlugin } from "../plugin.js";

/** `<Color>` as a `color_source_v3` of the source's size. */
export const colorObs: ObsSourcePlugin<typeof Color> = {
  kind: "color",
  create: (source) => ({
    input: {
      kind: "color_source_v3",
      settings: {
        color: abgr(source.props.color),
        width: Math.round(source.size.width),
        height: Math.round(source.size.height),
      },
    },
  }),
};

/** `#rrggbb` or `#rrggbbaa` as the unsigned ABGR integer OBS color sources store. */
export function abgr(color: string): number {
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  const alpha = color.length === 9 ? Number.parseInt(color.slice(7, 9), 16) : 255;
  return ((alpha << 24) | (blue << 16) | (green << 8) | red) >>> 0;
}
