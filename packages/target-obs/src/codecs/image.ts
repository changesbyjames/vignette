import type { ImageSource } from "@cbj/vignette-core";

import { selectInputKind, type ObsSourceCodec } from "./types.js";

export const imageCodec: ObsSourceCodec<ImageSource> = {
  kind: "source:image",
  inputKinds: ["image_source"],
  compile(source, context) {
    const inputKind = selectInputKind(this.inputKinds, context.availableInputKinds);
    if (inputKind === undefined) {
      return { supported: false, reason: "OBS image source input kind is unavailable." };
    }
    if (context.resolvedAsset === undefined) {
      return { supported: false, reason: `Image source '${source.id}' has no resolved OBS asset.` };
    }
    return {
      supported: true,
      inputKind,
      settings: { file: context.resolvedAsset, unload: false },
    };
  },
};
