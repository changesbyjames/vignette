import { deepFreeze, omitUndefined, type SourceBase } from "@strangecyan/vignette-core";
import { createElement, type ReactElement } from "react";

interface SourcePropsSource {
  readonly kind: `source:${string}`;
}

interface SourceElementSource {
  readonly kind: `source:${string}`;
}

type OptionalKeys<T> = {
  [K in keyof T]-?: Record<never, never> extends Pick<T, K> ? K : never;
}[keyof T];

/** Optional properties additionally accept an explicit `undefined`, meaning "use the default". */
type AllowUndefined<T> = {
  [K in keyof T]: K extends OptionalKeys<T> ? T[K] | undefined : T[K];
};

/**
 * Author-facing props for a source definition, excluding its fixed kind discriminator. Optional
 * fields accept `undefined`, which is treated as omitted.
 */
export type SourceProps<Source extends SourceBase & SourcePropsSource> = AllowUndefined<
  Omit<Source, "kind">
>;

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
