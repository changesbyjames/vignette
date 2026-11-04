import { createElement, type ReactElement } from "react";
import type { z } from "zod";

import type { Size } from "./geometry.js";

/** What a kind's `size` function knows when it is asked for a source's content size. */
export interface SourceSizeContext {
  /** The show's canvas size. */
  readonly canvas: Size;
  /**
   * The laid-out size of the layer placing the source. Undefined for a shared source, which may
   * be placed at several sizes; the kind then decides from its props or the canvas.
   */
  readonly layer?: Size;
}

/** Props schema of a source kind: an object schema whose output is JSON. */
export type SourcePropsSchemaType = z.ZodObject;

/** Raw props as an author passed them to a source component, before the kind's schema runs. */
export type SourceInput = z.input<SourcePropsSchemaType>;

/**
 * One source kind as the composer knows it: a name, a props schema, and how big its content is.
 * It never says how the kind is rendered; each target's plugin does.
 */
export interface SourceDefinition<Schema extends SourcePropsSchemaType = SourcePropsSchemaType> {
  /** The kind's name, carried through the snapshot and matched against target plugins. */
  readonly kind: string;
  /** Validates and normalises props; failures become `INVALID_PROPS` diagnostics. */
  readonly props: Schema;
  /** The content size used for `fit`, reported in the snapshot as `source.size`. */
  size(props: z.output<Schema>, context: SourceSizeContext): Size;
  /** Props whose string values are asset names, so the composer can list required assets. */
  readonly assets?: readonly (keyof z.output<Schema>)[];
}

/** Anything that carries a source definition: every `defineSource` component and `Frame`. */
export interface HasSourceDefinition<Schema extends SourcePropsSchemaType> {
  readonly definition: SourceDefinition<Schema>;
}

/** Optional explicit ID accepted by every source component. */
export interface SourceIdProp {
  /**
   * Explicit source ID. Required for a shared source declared at show level; an inline source
   * defaults to its layer's ID.
   */
  readonly id?: string;
}

/** Props of a source component: the kind's schema input plus an optional `id`. */
export type SourceComponentProps<Schema extends SourcePropsSchemaType> = z.input<Schema> &
  SourceIdProp;

/** A React component for one source kind, with its definition attached. */
export interface SourceComponent<
  Schema extends SourcePropsSchemaType = SourcePropsSchemaType,
> extends HasSourceDefinition<Schema> {
  (props: SourceComponentProps<Schema>): ReactElement;
}

/** The definition behind a source component, e.g. `SourceDefinitionOf<typeof Moq>`. */
export type SourceDefinitionOf<C> =
  C extends HasSourceDefinition<infer Schema> ? SourceDefinition<Schema> : never;

/** A kind's validated props as targets receive them, e.g. `SourcePropsOf<typeof Moq>`. */
export type SourcePropsOf<C> =
  C extends HasSourceDefinition<infer Schema> ? z.output<Schema> : never;

/** Props of the `source` host element that every source component renders. */
export interface SourceHostProps {
  readonly definition: SourceDefinition;
  readonly props: SourceInput;
  readonly id?: string;
}

/**
 * Defines a source kind and returns its React component. Nothing is registered with the
 * composer: the rendered element carries the definition, so importing the component is enough.
 */
export function defineSource<Schema extends SourcePropsSchemaType>(
  definition: SourceDefinition<Schema>,
): SourceComponent<Schema> {
  function SourceElement(props: SourceComponentProps<Schema>): ReactElement {
    const { id, ...rest } = props;
    const elementProps: SourceHostProps = { definition, props: rest, id };
    return createElement("source", elementProps);
  }
  SourceElement.definition = definition;
  return SourceElement;
}
