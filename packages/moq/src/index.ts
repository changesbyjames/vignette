/**
 * Core Media over QUIC source definition and composer extension. The same source kind is
 * implemented by `@strangecyan/vignette-moq/react` (authoring), `/dom` (`moqDomRenderer`), and
 * `/obs` (`moqObsCodec`).
 *
 * @module
 */
import {
  diagnostic,
  invalidHttpUrl,
  invalidSourceSize,
  type Diagnostic,
  type Size,
  type SourceBase,
  type SourceModule,
} from "@strangecyan/vignette-core";

/** Source kind shared by every MoQ entrypoint. */
export const MOQ_SOURCE_KIND = "source:moq";

/** Default end-to-end latency requested from a MoQ source. */
export const DEFAULT_MOQ_LATENCY_MS = 100;

/** One Media-over-QUIC broadcast rendered as a video source. */
export interface MoqSource extends SourceBase {
  readonly kind: typeof MOQ_SOURCE_KIND;
  readonly url: string;
  readonly broadcast: string;
  readonly size: Size;
  readonly latencyMs?: number;
  readonly video?: boolean;
  readonly audio?: boolean;
  readonly quality?: string;
  readonly disableWhenHidden?: boolean;
}

/** Creates a MoQ source definition. */
export function moqSource(input: Omit<MoqSource, "kind">): MoqSource {
  return { kind: MOQ_SOURCE_KIND, ...input };
}

/**
 * Composer facet: list it in `defineComposition({ extensions: [moqSourceModule] })`. The runtime
 * setup advertises the kind with these entrypoints, so a target without them reports which one to
 * register.
 */
export const moqSourceModule: SourceModule<MoqSource> = {
  kind: MOQ_SOURCE_KIND,
  entrypoints: { dom: "@strangecyan/vignette-moq/dom", obs: "@strangecyan/vignette-moq/obs" },
  intrinsicSize: (source) => source.size,
  /** Collect independent source-setting diagnostics rather than failing after the first invalid field. */
  validate(source, path) {
    const diagnostics: Diagnostic[] = [];
    const push = (item: Diagnostic | undefined) => {
      if (item !== undefined) diagnostics.push(item);
    };
    push(invalidHttpUrl(source.url, `${path}.url`));
    push(invalidSourceSize(source.size, `${path}.size`));
    if (source.broadcast.trim().length === 0) {
      push(
        diagnostic(
          "INVALID_SOURCE_SETTING",
          "error",
          `${path}.broadcast`,
          "MoQ broadcast name must not be empty.",
        ),
      );
    }
    if (
      source.latencyMs !== undefined &&
      (!Number.isSafeInteger(source.latencyMs) || source.latencyMs < 0 || source.latencyMs > 30_000)
    ) {
      push(
        diagnostic(
          "INVALID_SOURCE_SETTING",
          "error",
          `${path}.latencyMs`,
          "MoQ latency must be an integer between 0 and 30000 milliseconds.",
        ),
      );
    }
    if (source.quality?.trim().length === 0) {
      push(
        diagnostic(
          "INVALID_SOURCE_SETTING",
          "error",
          `${path}.quality`,
          "MoQ quality must be 'auto' or a non-empty rendition name.",
        ),
      );
    }
    return diagnostics;
  },
};
