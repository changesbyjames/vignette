/**
 * OBS codec for installations that provide the `moq_source` input plugin.
 *
 * @module
 */
import { selectInputKind, type ObsSourceCodec } from "@strangecyan/vignette-target-obs";

import { DEFAULT_MOQ_LATENCY_MS, MOQ_SOURCE_KIND, type MoqSource } from "./index.js";

/**
 * OBS facet: register with the OBS runtime (`extensions: [moqObsCodec]`), or load this entrypoint
 * with `vignette obs --extension @strangecyan/vignette-moq/obs`.
 */
export const moqObsCodec: ObsSourceCodec<MoqSource> = {
  kind: MOQ_SOURCE_KIND,
  inputKinds: ["moq_source"],
  /** Choose an available MoQ input kind and translate only supported source settings for that codec. */
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
