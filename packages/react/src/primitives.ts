import type {
  ContentAlignment,
  BrowserSource as BrowserSourceDefinition,
  ColorSource as ColorSourceDefinition,
  FitMode,
  ImageSource as ImageSourceDefinition,
  Insets,
  LayoutStyle,
  MediaFileSource as MediaSourceDefinition,
  Size,
  AnySourceDefinition,
} from "@strangecyan/vignette-core";
import { createElement, type ReactElement, type ReactNode } from "react";

import { sourceElement, type SourceProps } from "./source-element.js";

interface SourceDefinitionProps {
  readonly definition: AnySourceDefinition;
}

interface ChildrenProps {
  readonly children?: ReactNode;
}

/** Declares the root of a Vignette scene graph. */
export function Broadcast(props: ChildrenProps): ReactElement {
  return createElement("broadcast", null, props.children);
}

/** Declares the reusable sources available to scenes. */
export function Sources(props: ChildrenProps): ReactElement {
  return createElement("sources", null, props.children);
}

/** Props for a scene with an explicit remote identity. */
export interface SceneProps extends ChildrenProps {
  readonly id: string;
  readonly label?: string | undefined;
}

/** Declares one independently materialized scene. */
export function Scene(props: SceneProps): ReactElement {
  return createElement("scene", props, props.children);
}

/** Props for a virtual Yoga layout container. */
export interface BoxProps extends ChildrenProps {
  readonly style?: LayoutStyle | undefined;
}

/** Groups children for Yoga layout without creating a target object. */
export function Box(props: BoxProps): ReactElement {
  return createElement("box", props, props.children);
}

/** Props for placing a source in a scene. */
export interface LayerProps {
  readonly id: string;
  readonly sourceId: string;
  readonly style?: LayoutStyle | undefined;
  readonly fit?: FitMode | undefined;
  readonly alignment?: ContentAlignment | undefined;
  readonly crop?: Partial<Insets> | undefined;
  readonly visible?: boolean | undefined;
  readonly opacity?: number | undefined;
  readonly rotation?: number | undefined;
}

/** Places one declared source in the current scene. */
export function Layer(props: LayerProps): ReactElement {
  return createElement("layer", props);
}

/** Props for placing one scene within another. */
export interface SceneLayerProps {
  readonly id: string;
  readonly sceneId: string;
  readonly style?: LayoutStyle | undefined;
  readonly visible?: boolean | undefined;
  readonly opacity?: number | undefined;
  readonly rotation?: number | undefined;
}

/** Places a nested scene in the current scene. */
export function SceneLayer(props: SceneLayerProps): ReactElement {
  return createElement("scene-layer", props);
}

/** Declares one already-built source definition; the escape hatch for dynamic compositions. */
export function Source(props: SourceDefinitionProps): ReactElement {
  return createElement("source", props);
}

/** Props for declaring an image source. */
export type ImageSourceProps = SourceProps<ImageSourceDefinition>;

/** Declares a reusable image asset source. */
export function ImageSource(props: ImageSourceProps): ReactElement {
  return sourceElement<ImageSourceDefinition>("source:image", props);
}

/** Props for declaring a media-file source. */
export type MediaSourceProps = SourceProps<MediaSourceDefinition>;

/** Declares a reusable local media source. */
export function MediaSource(props: MediaSourceProps): ReactElement {
  return sourceElement<MediaSourceDefinition>("source:media-file", props);
}

/** Props for declaring a browser source. */
export type BrowserSourceProps = SourceProps<BrowserSourceDefinition>;

/** Declares a reusable browser source. */
export function BrowserSource(props: BrowserSourceProps): ReactElement {
  return sourceElement<BrowserSourceDefinition>("source:browser", props);
}

/** Props for declaring a solid color source. */
export type ColorSourceProps = SourceProps<ColorSourceDefinition>;

/** Declares a reusable solid color source. */
export function ColorSource(props: ColorSourceProps): ReactElement {
  return sourceElement<ColorSourceDefinition>("source:color", props);
}

/** Props that declare and place an inline browser source together. */
export interface BrowserViewProps extends Omit<LayerProps, "sourceId"> {
  readonly sourceId: string;
  readonly url: string;
  /** Page size in CSS pixels. Defaults to the laid-out size of this layer. */
  readonly viewport?: Size | undefined;
  readonly label?: string | undefined;
  readonly shutdownWhenHidden?: boolean | undefined;
}

/**
 * Declares and places one browser source in a single layout node. Higher-level optional packages
 * can use this without adding target-specific data to core snapshots.
 */
export function BrowserView(props: BrowserViewProps): ReactElement {
  return createElement("browser-view", props);
}
