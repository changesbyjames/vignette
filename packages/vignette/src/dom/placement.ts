import type { Size } from "../core/geometry.js";
import type { Item } from "../core/snapshot.js";
import { px } from "./styles.js";

/**
 * Positions a source's element inside its item's content host from the compiled destination and
 * crop, rather than performing CSS layout. The element keeps the source's own `size` (so a page
 * lays out at its viewport) and is scaled into the destination by a transform.
 */
export function applyContentPlacement(
  contentHost: HTMLElement,
  element: HTMLElement,
  sourceSize: Size,
  item: Item,
): void {
  const { destination, sourceCrop: crop } = item.placement;
  Object.assign(contentHost.style, {
    left: px(destination.x - item.frame.x),
    top: px(destination.y - item.frame.y),
    width: px(destination.width),
    height: px(destination.height),
  });

  const effectiveWidth = sourceSize.width - crop.left - crop.right;
  const effectiveHeight = sourceSize.height - crop.top - crop.bottom;
  const scaleX = effectiveWidth > 0 ? destination.width / effectiveWidth : 1;
  const scaleY = effectiveHeight > 0 ? destination.height / effectiveHeight : 1;
  Object.assign(element.style, {
    position: "absolute",
    boxSizing: "border-box",
    border: "0",
    margin: "0",
    maxWidth: "none",
    maxHeight: "none",
    pointerEvents: "none",
    left: px(-crop.left * scaleX),
    top: px(-crop.top * scaleY),
    width: px(sourceSize.width),
    height: px(sourceSize.height),
    transform: `scale(${String(scaleX)}, ${String(scaleY)})`,
    transformOrigin: "top left",
  });
}
