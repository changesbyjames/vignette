import { deepFreeze, type SourceBase } from "@cbj/vignette-core";
import { createElement, type ReactElement } from "react";

export type SourceProps<Source extends SourceBase & { readonly kind: `source:${string}` }> = Omit<
  Source,
  "kind"
>;

/**
 * Lowers typed source props to the generic `source` host element. Extension packages use this
 * to author components for their own source kinds without the renderer knowing about them.
 */
export function sourceElement<Source extends SourceBase & { readonly kind: `source:${string}` }>(
  kind: Source["kind"],
  props: SourceProps<Source>,
): ReactElement {
  const definition: Record<string, unknown> = { kind };
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) definition[key] = value;
  }
  return createElement("source", { definition: deepFreeze(structuredClone(definition)) });
}
