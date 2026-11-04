import type { Size } from "./geometry.js";
import type { Canvas, LayerProps, LayoutStyle, Source, SourceProps } from "./snapshot.js";

/**
 * A source declared inline under a layer. Its ID is the layer's; its size depends on the layer's
 * laid-out frame, so the lowering step binds the kind's `size` function here and the compiler
 * calls it once layout is known.
 */
export interface InlineSource {
  readonly id: string;
  readonly kind: string;
  readonly props: SourceProps;
  size(layer: Size): Size;
}

/** A `<Use source>` placement of a shared source declared at show level. */
export interface SourceRef {
  readonly ref: string;
}

interface LayoutNodeBase {
  readonly id: string;
  readonly style?: LayoutStyle;
  readonly layer: LayerProps;
  /** The layer kind (`"layer"` for a plain `<Layer>`) and its validated props. */
  readonly kind: string;
  readonly props: SourceProps;
}

/** A layer that groups other layers for layout. It never becomes a target object. */
export interface GroupLayoutNode extends LayoutNodeBase {
  readonly children: readonly LayoutNode[];
}

/** A layer that places one source. It becomes one snapshot item. */
export interface SourceLayoutNode extends LayoutNodeBase {
  readonly source: InlineSource | SourceRef;
}

/** One layer of a scene, as the layout compiler consumes it. */
export type LayoutNode = GroupLayoutNode | SourceLayoutNode;

/** One scene: a root layer that fills the canvas and holds the scene's layers. */
export interface ShowTreeScene {
  readonly id: string;
  readonly root: LayoutNode;
}

/**
 * The compiler's input: the React host tree lowered into plain data with every ID resolved.
 * Shared sources are already sized because their size cannot depend on any one layer.
 */
export interface ShowTree {
  readonly id: string;
  readonly canvas: Canvas;
  readonly activeScene?: string;
  readonly sharedSources: readonly Source[];
  readonly scenes: readonly ShowTreeScene[];
}

/** Tests whether a layout node groups other layers. */
export function isGroupNode(node: LayoutNode): node is GroupLayoutNode {
  return "children" in node;
}

/** Tests whether a layer's source is a reference to a shared source. */
export function isSourceRef(source: InlineSource | SourceRef): source is SourceRef {
  return "ref" in source;
}
