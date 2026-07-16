import type { ColorSource } from "@cbj/vignette-core";

import { selectInputKind, type ObsSourceCodec } from "./types.js";

/** Built-in OBS color-source codec. */
export const colorCodec: ObsSourceCodec<ColorSource> = {
  kind: "source:color",
  inputKinds: ["color_source_v3", "color_source"],
  compile(source, context) {
    const inputKind = selectInputKind(this.inputKinds, context.availableInputKinds);
    if (inputKind === undefined) {
      return { supported: false, reason: "OBS color source input kind is unavailable." };
    }
    return {
      supported: true,
      inputKind,
      settings: {
        color: toObsColor(source.color),
        ...(source.size === undefined
          ? {}
          : { width: source.size.width, height: source.size.height }),
      },
    };
  },
};

function toObsColor(color: string): number {
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  const alpha = color.length === 9 ? Number.parseInt(color.slice(7, 9), 16) : 255;
  return ((alpha << 24) | (blue << 16) | (green << 8) | red) >>> 0;
}
