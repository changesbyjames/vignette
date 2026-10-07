import type { AnySourceDefinition, Size } from "@strangecyan/vignette-core";

import type { ObsJsonObject } from "../operations.js";

interface ObsSupportedCodecResult {
  readonly supported: true;
  readonly inputKind: string;
  readonly settings: ObsJsonObject;
}

interface ObsUnsupportedCodecResult {
  readonly supported: false;
  readonly reason: string;
}

/** OBS capabilities and resolved metadata available while compiling a source. */
export interface ObsCodecContext {
  readonly availableInputKinds: ReadonlySet<string>;
  readonly resolvedAsset?: string;
  /**
   * Absolute base OBS uses for root-relative URLs it loads itself (e.g. browser sources), or
   * undefined when none is configured.
   */
  readonly baseUrl?: string;
  readonly browserViewport?: Size;
}

/** Supported OBS input settings or a deterministic unsupported reason. */
export type ObsCodecResult = ObsSupportedCodecResult | ObsUnsupportedCodecResult;

/**
 * Compiles one source kind to OBS input settings. Extension packages export a codec and pass it
 * to the runtime through `OBSRuntimeOptions.extensions`.
 */
export interface ObsSourceCodec<Source extends AnySourceDefinition = AnySourceDefinition> {
  readonly kind: Source["kind"];
  readonly inputKinds: readonly string[];
  /** Properties button pressed once per connection after the input first settles. */
  readonly refreshProperty?: string;
  compile(source: Source, context: ObsCodecContext): ObsCodecResult;
}

/** Selects the first candidate input kind advertised by OBS. */
export function selectInputKind(
  candidates: readonly string[],
  available: ReadonlySet<string>,
): string | undefined {
  return candidates.find((candidate) => available.has(candidate));
}
