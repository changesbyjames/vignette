import type { ContentAlignment, Insets, Size } from "./geometry.js";
import type { LayerId, ProjectId, SceneId, SourceId } from "./ids.js";
import type { SourceDefinition } from "./sources.js";

export type Percentage = `${number}%`;
export type Length = number | Percentage | "auto";
export type DefiniteLength = number | Percentage;

export interface EdgeValues<T> {
  readonly top?: T;
  readonly right?: T;
  readonly bottom?: T;
  readonly left?: T;
}

export type Edges<T> = T | EdgeValues<T>;
export type FlexDirection = "row" | "row-reverse" | "column" | "column-reverse";
export type JustifyContent =
  "flex-start" | "center" | "flex-end" | "space-between" | "space-around" | "space-evenly";
export type Align = "auto" | "flex-start" | "center" | "flex-end" | "stretch";

export interface LayoutStyle {
  readonly width?: Length;
  readonly height?: Length;
  readonly minWidth?: DefiniteLength;
  readonly minHeight?: DefiniteLength;
  readonly maxWidth?: DefiniteLength;
  readonly maxHeight?: DefiniteLength;
  readonly aspectRatio?: number;
  readonly margin?: Edges<Length>;
  readonly padding?: Edges<DefiniteLength>;
  readonly gap?: DefiniteLength;
  readonly rowGap?: DefiniteLength;
  readonly columnGap?: DefiniteLength;
  readonly flexDirection?: FlexDirection;
  readonly flexGrow?: number;
  readonly flexShrink?: number;
  readonly flexBasis?: Length;
  readonly justifyContent?: JustifyContent;
  readonly alignItems?: Exclude<Align, "auto">;
  readonly alignSelf?: Align;
  readonly position?: "relative" | "absolute";
  readonly inset?: Edges<DefiniteLength | "auto">;
  readonly overflow?: "visible" | "hidden";
}

export interface BroadcastCanvas extends Size {
  readonly frameRate?: number;
}

export interface BroadcastNode {
  readonly kind: "broadcast";
  readonly projectId: ProjectId;
  readonly canvas: BroadcastCanvas;
  readonly children: readonly BroadcastChild[];
}

export type BroadcastChild = SourcesNode | SceneNode;

export interface SourcesNode {
  readonly kind: "sources";
  readonly children: readonly SourceDefinition[];
}

export interface SceneNode {
  readonly kind: "scene";
  readonly id: SceneId;
  readonly label?: string;
  readonly children: readonly LayoutNode[];
}

interface StyledNode {
  readonly style?: LayoutStyle;
}

export interface BoxNode extends StyledNode {
  readonly kind: "box";
  readonly children: readonly LayoutNode[];
}

export type FitMode = "contain" | "cover" | "fill";

export interface LayerNode extends StyledNode {
  readonly kind: "layer";
  readonly id: LayerId;
  readonly sourceId: SourceId;
  readonly fit?: FitMode;
  readonly alignment?: ContentAlignment;
  readonly crop?: Partial<Insets>;
  readonly visible?: boolean;
  readonly opacity?: number;
  readonly rotation?: number;
}

export interface SceneLayerNode extends StyledNode {
  readonly kind: "scene-layer";
  readonly id: LayerId;
  readonly sceneId: SceneId;
  readonly visible?: boolean;
  readonly opacity?: number;
  readonly rotation?: number;
}

export type LayoutNode = BoxNode | LayerNode | SceneLayerNode;
