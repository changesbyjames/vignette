import { createElement, type ReactElement } from "react";
import type { z } from "zod";

import type { LayerElementProps } from "../react-authoring/elements.js";
import type { LayerHostProps } from "../react-authoring/host-types.js";
import type { Item } from "./snapshot.js";

/** Props schema of a layer kind: an object schema whose output is JSON. */
export type LayerPropsSchemaType = z.ZodObject;

/** Raw props as an author passed them to a layer component, before the kind's schema runs. */
export type LayerInput = z.input<LayerPropsSchemaType>;

/** The kind of a plain `<Layer>`: placed by every target's built-in placement. */
export const PLAIN_LAYER_KIND = "layer";

/**
 * One layer kind as the composer knows it: a name and a props schema. Like a source kind, it never
 * says how the kind is placed; each target's layer plugin does. A plain `<Layer>` is the kind
 * {@link PLAIN_LAYER_KIND} with no props.
 */
export interface LayerDefinition<Schema extends LayerPropsSchemaType = LayerPropsSchemaType> {
  /** The kind's name, carried through the snapshot and matched against target layer plugins. */
  readonly kind: string;
  /** Validates and normalises the kind's props; failures become `INVALID_PROPS` diagnostics. */
  readonly props: Schema;
}

/** Anything that carries a layer definition: every `defineLayer` component. */
export interface HasLayerDefinition<Schema extends LayerPropsSchemaType> {
  readonly definition: LayerDefinition<Schema>;
}

/** A snapshot item whose props are typed by its kind's schema. */
export interface TypedItem<Props> extends Omit<Item, "props"> {
  readonly props: Props;
}

/** A snapshot item whose props are typed by its kind's schema, e.g. `ItemOf<typeof MotionLayer>`. */
export type ItemOf<Def> =
  Def extends HasLayerDefinition<infer Schema extends LayerPropsSchemaType>
    ? TypedItem<z.output<Schema>>
    : Item;

/** Reads an item's props through its kind's definition; undefined for an item of another kind. */
export function itemProps<Schema extends LayerPropsSchemaType>(
  definition: LayerDefinition<Schema>,
  item: Item,
): z.output<Schema> | undefined {
  return item.kind === definition.kind ? definition.props.parse(item.props) : undefined;
}

/** Props of a layer component: a plain layer's props plus the kind's schema input. */
export type LayerComponentProps<Schema extends LayerPropsSchemaType> = LayerElementProps &
  z.input<Schema>;

/** A React component for one layer kind, with its definition attached. */
export interface LayerComponent<
  Schema extends LayerPropsSchemaType = LayerPropsSchemaType,
> extends HasLayerDefinition<Schema> {
  (props: LayerComponentProps<Schema>): ReactElement;
}

/**
 * Defines a layer kind and returns its React component: a `<Layer>` that also carries the kind's
 * props. Nothing is registered with the composer: the rendered element carries the definition,
 * so importing the component is enough. Every target that renders the show needs a layer plugin
 * for the kind, as it needs a source plugin for each source kind.
 */
export function defineLayer<Schema extends LayerPropsSchemaType>(
  definition: LayerDefinition<Schema>,
): LayerComponent<Schema> {
  function LayerElement(props: LayerComponentProps<Schema>): ReactElement {
    const { children, id, style, fit, align, crop, opacity, rotation, visible, ...kindProps } =
      props;
    const element: LayerHostProps = {
      id,
      style,
      fit,
      align,
      crop,
      opacity,
      rotation,
      visible,
      definition,
      // What remains after the layer's own props are taken are the kind's; its schema validates
      // them when lowered.
      props: kindProps,
    };
    return createElement("layer", element, children);
  }
  LayerElement.definition = definition;
  return LayerElement;
}
