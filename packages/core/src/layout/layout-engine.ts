import type { LayoutNode } from "../authoring.js";
import type { Rect, Size } from "../geometry.js";

/** One authoring node and its engine-computed frame relative to its parent. */
export interface LayoutRecord {
  readonly node: LayoutNode;
  readonly frame: Rect;
  readonly path: string;
  readonly children: readonly LayoutRecord[];
}

/** Synchronous layout contract consumed by snapshot compilation. */
export interface LayoutEngine {
  layout(nodes: readonly LayoutNode[], canvas: Size): readonly LayoutRecord[];
}
