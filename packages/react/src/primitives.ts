import type {
  ContentAlignment,
  BrowserSource as BrowserSourceDefinition,
  ColorSource as ColorSourceDefinition,
  FitMode,
  ImageSource as ImageSourceDefinition,
  Insets,
  LayerId,
  LayoutStyle,
  MediaFileSource as MediaSourceDefinition,
  SceneId,
  Size,
  AnySourceDefinition,
  SourceId,
} from "@strangecyan/vignette-core";
import { createElement, type ReactElement, type ReactNode } from "react";

import { sourceElement, type SourceProps } from "./source-element.js";

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
  readonly id: SceneId;
  readonly label?: string;
}

/** Declares one independently materialized scene. */
export function Scene(props: SceneProps): ReactElement {
  return createElement("scene", props, props.children);
}

/** Props for a virtual Yoga layout container. */
export interface BoxProps extends ChildrenProps {
  readonly style?: LayoutStyle;
}

/** Groups children for Yoga layout without creating a target object. */
export function Box(props: BoxProps): ReactElement {
  return createElement("box", props, props.children);
}

/** Props for placing a source in a scene. */
export interface LayerProps {
  readonly id: LayerId;
  readonly sourceId: SourceId;
  readonly style?: LayoutStyle;
  readonly fit?: FitMode;
  readonly alignment?: ContentAlignment;
  readonly crop?: Partial<Insets>;
  readonly visible?: boolean;
  readonly opacity?: number;
  readonly rotation?: number;
}

/** Places one declared source in the current scene. */
export function Layer(props: LayerProps): ReactElement {
  return createElement("layer", props);
}

/** Props for placing one scene within another. */
export interface SceneLayerProps {
  readonly id: LayerId;
  readonly sceneId: SceneId;
  readonly style?: LayoutStyle;
  readonly visible?: boolean;
  readonly opacity?: number;
  readonly rotation?: number;
}

/** Places a nested scene in the current scene. */
export function SceneLayer(props: SceneLayerProps): ReactElement {
  return createElement("scene-layer", props);
}

/** Declares one already-built source definition; the escape hatch for dynamic compositions. */
export function Source(props: { readonly definition: AnySourceDefinition }): ReactElement {
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
  readonly sourceId: SourceId;
  readonly url: string;
  readonly viewport: Size;
  readonly label?: string;
  readonly shutdownWhenHidden?: boolean;
}

/**
 * Declares and places one browser source in a single layout node. Higher-level optional packages
 * can use this without adding target-specific data to core snapshots.
 */
export function BrowserView(props: BrowserViewProps): ReactElement {
  return createElement("browser-view", props);
}
