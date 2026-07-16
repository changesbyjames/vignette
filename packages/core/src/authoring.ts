import type { ContentAlignment, Insets, Size } from "./geometry.js";
import type { LayerId, ProjectId, SceneId, SourceId } from "./ids.js";
import type { AnySourceDefinition } from "./sources.js";

/** A CSS-like percentage length. */
export type Percentage = `${number}%`;
/** A Yoga length in pixels, percent, or automatic sizing. */
export type Length = number | Percentage | "auto";
/** A Yoga length that always resolves to a numeric size. */
export type DefiniteLength = number | Percentage;

/** Optional values for the four box edges. */
export interface EdgeValues<T> {
  readonly top?: T;
  readonly right?: T;
  readonly bottom?: T;
  readonly left?: T;
}

/** One value for every edge or individual edge values. */
export type Edges<T> = T | EdgeValues<T>;
/** Main-axis direction for a flex container. */
export type FlexDirection = "row" | "row-reverse" | "column" | "column-reverse";
/** Distribution of children along a flex container's main axis. */
export type JustifyContent =
  "flex-start" | "center" | "flex-end" | "space-between" | "space-around" | "space-evenly";
/** Cross-axis alignment accepted by Yoga layout nodes. */
export type Align = "auto" | "flex-start" | "center" | "flex-end" | "stretch";

/** Target-neutral subset of Yoga layout properties supported by Vignette. */
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

/** Fixed output dimensions and optional frame rate for a broadcast. */
export interface BroadcastCanvas extends Size {
  readonly frameRate?: number;
}

/** Root node of an authoring graph. */
export interface BroadcastNode {
  readonly kind: "broadcast";
  readonly projectId: ProjectId;
  readonly canvas: BroadcastCanvas;
  readonly children: readonly BroadcastChild[];
}

/** Top-level source or scene collection accepted by a broadcast. */
export type BroadcastChild = SourcesNode | SceneNode;

/** Collection of reusable source definitions. */
export interface SourcesNode {
  readonly kind: "sources";
  readonly children: readonly AnySourceDefinition[];
}

/** Authoring scene containing layout nodes. */
export interface SceneNode {
  readonly kind: "scene";
  readonly id: SceneId;
  readonly label?: string;
  readonly children: readonly LayoutNode[];
}

interface StyledNode {
  readonly style?: LayoutStyle;
}

/** Virtual Yoga container that does not materialize in a target. */
export interface BoxNode extends StyledNode {
  readonly kind: "box";
  readonly children: readonly LayoutNode[];
}

/** Scaling strategy for placing source content in a layer. */
export type FitMode = "contain" | "cover" | "fill";

/** Placement of a source within a scene. */
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

/** Placement of one scene within another scene. */
export interface SceneLayerNode extends StyledNode {
  readonly kind: "scene-layer";
  readonly id: LayerId;
  readonly sceneId: SceneId;
  readonly visible?: boolean;
  readonly opacity?: number;
  readonly rotation?: number;
}

/** Any node that participates in scene layout. */
export type LayoutNode = BoxNode | LayerNode | SceneLayerNode;
