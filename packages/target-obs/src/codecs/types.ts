import type { Size, SourceKind, SourceKinds } from "@cbj/react-obs-core";

import type { ObsJsonObject } from "../operations.js";

export interface ObsCodecContext {
  readonly availableInputKinds: ReadonlySet<string>;
  readonly resolvedAsset?: string;
  readonly browserViewport?: Size;
}

export type ObsCodecResult =
  | {
      readonly supported: true;
      readonly inputKind: string;
      readonly settings: ObsJsonObject;
    }
  | { readonly supported: false; readonly reason: string };

/**
 * Compiles one source kind to OBS input settings. Extension packages export a codec and pass it
 * to the runtime through `OBSRuntimeOptions.extensions`.
 */
export interface ObsSourceCodec<K extends SourceKind = SourceKind> {
  readonly kind: K;
  readonly inputKinds: readonly string[];
  /** Properties button pressed once per connection after the input first settles. */
  readonly refreshProperty?: string;
  compile(source: SourceKinds[K], context: ObsCodecContext): ObsCodecResult;
}

export function selectInputKind(
  candidates: readonly string[],
  available: ReadonlySet<string>,
): string | undefined {
  return candidates.find((candidate) => available.has(candidate));
}
