import type { Insets, Rect } from "../geometry.js";

/** Rounds each edge to whole pixels so adjacent layers stay seam-free. */
export function roundRect(rect: Rect): Rect {
  const left = Math.round(rect.x);
  const top = Math.round(rect.y);
  const right = Math.round(rect.x + rect.width);
  const bottom = Math.round(rect.y + rect.height);
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

export function roundInsets(insets: Insets): Insets {
  return {
    top: Math.max(0, Math.round(insets.top)),
    right: Math.max(0, Math.round(insets.right)),
    bottom: Math.max(0, Math.round(insets.bottom)),
    left: Math.max(0, Math.round(insets.left)),
  };
}
