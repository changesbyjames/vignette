import { deepFreeze, omitUndefined, type SourceBase } from "@strangecyan/vignette-core";
import { createElement, type ReactElement } from "react";

interface SourcePropsSource {
  readonly kind: `source:${string}`;
}

interface SourceElementSource {
  readonly kind: `source:${string}`;
}

/** Author-facing props for a source definition, excluding its fixed kind discriminator. */
export type SourceProps<Source extends SourceBase & SourcePropsSource> = Omit<Source, "kind">;

/**
 * Lowers typed source props to the generic `source` host element. Extension packages use this
 * to author components for their own source kinds without the renderer knowing about them.
 */
export function sourceElement<Source extends SourceBase & SourceElementSource>(
  kind: Source["kind"],
  props: SourceProps<Source>,
): ReactElement {
  const definition = omitUndefined({ ...props, kind });
  return createElement("source", { definition: deepFreeze(structuredClone(definition)) });
}
