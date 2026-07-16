/**
 * Core Media over QUIC source definition and composer extension.
 *
 * @module
 */
import {
  diagnostic,
  invalidHttpUrl,
  invalidSourceSize,
  sourceId,
  type Diagnostic,
  type Size,
  type SourceBase,
  type SourceModule,
} from "@cbj/react-obs-core";

export const DEFAULT_MOQ_LATENCY_MS = 100;

/** One Media-over-QUIC broadcast rendered as a video source. */
export interface MoqSource extends SourceBase {
  readonly kind: "source:moq";
  readonly url: string;
  readonly broadcast: string;
  readonly size: Size;
  readonly latencyMs?: number;
  readonly video?: boolean;
  readonly audio?: boolean;
  readonly quality?: string;
  readonly disableWhenHidden?: boolean;
}

declare module "@cbj/react-obs-core" {
  interface SourceKinds {
    "source:moq": MoqSource;
  }
}

export function moqSource(
  input: Omit<MoqSource, "kind" | "id"> & { readonly id: string },
): MoqSource {
  return { kind: "source:moq", ...input, id: sourceId(input.id) };
}

/** Core facet: register with the composer root (`extensions: [moqSourceModule]`). */
export const moqSourceModule: SourceModule<"source:moq"> = {
  kind: "source:moq",
  intrinsicSize: (source) => source.size,
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
