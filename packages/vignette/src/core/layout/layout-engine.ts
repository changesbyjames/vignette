import type { Rect, Size } from "../geometry.js";
import type { LayoutNode } from "../show-tree.js";

/** One layout node and its engine-computed frame relative to its parent. */
export interface LayoutRecord {
  readonly node: LayoutNode;
  readonly frame: Rect;
  readonly path: string;
  readonly children: readonly LayoutRecord[];
}

/**
 * Synchronous layout contract consumed by snapshot compilation. `yogaLayoutEngine` is the default;
 * hosts that cannot import wasm pass one from `loadYoga`.
 */
export interface LayoutEngine {
  layout(nodes: readonly LayoutNode[], canvas: Size): readonly LayoutRecord[];
}
