import { deepFreeze, type SourceKind, type SourceKinds } from "@cbj/react-obs-core";
import { createElement, type ReactElement } from "react";

export type SourceProps<K extends SourceKind> = Omit<SourceKinds[K], "kind">;

/**
 * Lowers typed source props to the generic `source` host element. Extension packages use this
 * to author components for their own source kinds without the renderer knowing about them.
 */
export function sourceElement<K extends SourceKind>(kind: K, props: SourceProps<K>): ReactElement {
  const definition: Record<string, unknown> = { kind };
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) definition[key] = value;
  }
  return createElement("source", { definition: deepFreeze(structuredClone(definition)) });
}
