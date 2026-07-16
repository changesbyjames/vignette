/**
 * OBS codec for installations that provide the `moq_source` input plugin.
 *
 * @module
 */
import { selectInputKind, type ObsSourceCodec } from "@cbj/vignette-target-obs";

import { DEFAULT_MOQ_LATENCY_MS } from "./index.js";

/** OBS facet: register with the OBS runtime (`extensions: [moqObsCodec]`). */
export const moqObsCodec: ObsSourceCodec<"source:moq"> = {
  kind: "source:moq",
  inputKinds: ["moq_source"],
  compile(source, context) {
    const inputKind = selectInputKind(this.inputKinds, context.availableInputKinds);
    if (inputKind === undefined) {
      return { supported: false, reason: "OBS MoQ input kind 'moq_source' is unavailable." };
    }
    return {
      supported: true,
      inputKind,
      settings: {
        url: source.url,
        broadcast: source.broadcast,
        latency_ms: source.latencyMs ?? DEFAULT_MOQ_LATENCY_MS,
        video: source.video ?? true,
        audio: source.audio ?? true,
        quality: source.quality ?? "auto",
        disable_when_hidden: source.disableWhenHidden ?? true,
      },
    };
  },
};
