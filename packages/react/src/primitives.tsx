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
} from "@cbj/vignette-core";
import { createElement, type ReactElement, type ReactNode } from "react";

import { sourceElement, type SourceProps } from "./source-element.js";

interface ChildrenProps {
  readonly children?: ReactNode;
}

export function Broadcast(props: ChildrenProps): ReactElement {
  return createElement("broadcast", null, props.children);
}

export function Sources(props: ChildrenProps): ReactElement {
  return createElement("sources", null, props.children);
}

export interface SceneProps extends ChildrenProps {
  readonly id: SceneId;
  readonly label?: string;
}

export function Scene(props: SceneProps): ReactElement {
  return createElement("scene", props, props.children);
}

export interface BoxProps extends ChildrenProps {
  readonly style?: LayoutStyle;
}

export function Box(props: BoxProps): ReactElement {
  return createElement("box", props, props.children);
}

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

export function Layer(props: LayerProps): ReactElement {
  return createElement("layer", props);
}

export interface SceneLayerProps {
  readonly id: LayerId;
  readonly sceneId: SceneId;
  readonly style?: LayoutStyle;
  readonly visible?: boolean;
  readonly opacity?: number;
  readonly rotation?: number;
}

export function SceneLayer(props: SceneLayerProps): ReactElement {
  return createElement("scene-layer", props);
}

/** Declares one already-built source definition; the escape hatch for dynamic compositions. */
export function Source(props: { readonly definition: AnySourceDefinition }): ReactElement {
  return createElement("source", props);
}

export type ImageSourceProps = SourceProps<ImageSourceDefinition>;

export function ImageSource(props: ImageSourceProps): ReactElement {
  return sourceElement<ImageSourceDefinition>("source:image", props);
}

export type MediaSourceProps = SourceProps<MediaSourceDefinition>;

export function MediaSource(props: MediaSourceProps): ReactElement {
  return sourceElement<MediaSourceDefinition>("source:media-file", props);
}

export type BrowserSourceProps = SourceProps<BrowserSourceDefinition>;

export function BrowserSource(props: BrowserSourceProps): ReactElement {
  return sourceElement<BrowserSourceDefinition>("source:browser", props);
}

export type ColorSourceProps = SourceProps<ColorSourceDefinition>;

export function ColorSource(props: ColorSourceProps): ReactElement {
  return sourceElement<ColorSourceDefinition>("source:color", props);
}

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
