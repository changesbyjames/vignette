import type { CSSProperties } from "react";

import type { Rect } from "../core/geometry.js";
import type { Canvas, Item, Source } from "../core/snapshot.js";

/** The canvas at its compiled size, scaled to fit the stage. */
export function canvasStyle(canvas: Canvas, scale: number): CSSProperties {
  return {
    position: "absolute",
    left: 0,
    top: 0,
    width: canvas.width,
    height: canvas.height,
    overflow: "hidden",
    isolation: "isolate",
    transform: scale === 1 ? undefined : `scale(${String(scale)})`,
    transformOrigin: "top left",
  };
}

/** The largest scale at which the canvas fits the container; 1 before it is measured. */
export function fitScale(canvas: Canvas, width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1;
  return Math.min(width / canvas.width, height / canvas.height);
}

/** An item's box at its frame, with its presentation and canvas clip. */
export function itemStyle(item: Item, order: number): CSSProperties {
  return {
    position: "absolute",
    overflow: "hidden",
    display: item.visible ? "block" : "none",
    left: item.frame.x,
    top: item.frame.y,
    width: item.frame.width,
    height: item.frame.height,
    opacity: item.opacity,
    transform: item.rotation === 0 ? undefined : `rotate(${String(item.rotation)}deg)`,
    transformOrigin: "center center",
    clipPath: item.clip === undefined ? undefined : clipPath(item.frame, item.clip),
    zIndex: order,
  };
}

/** The fitted destination of an item's content, relative to the item's frame. */
export function contentStyle(item: Item): CSSProperties {
  const { destination } = item.placement;
  return {
    position: "absolute",
    overflow: "hidden",
    left: destination.x - item.frame.x,
    top: destination.y - item.frame.y,
    width: destination.width,
    height: destination.height,
  };
}

/**
 * The box a source's view fills: the source's own `size` (so a page lays out at its viewport),
 * cropped and scaled into the destination by a transform.
 */
export function sourceBoxStyle(source: Source, item: Item): CSSProperties {
  const { destination, sourceCrop: crop } = item.placement;
  const effectiveWidth = source.size.width - crop.left - crop.right;
  const effectiveHeight = source.size.height - crop.top - crop.bottom;
  const scaleX = effectiveWidth > 0 ? destination.width / effectiveWidth : 1;
  const scaleY = effectiveHeight > 0 ? destination.height / effectiveHeight : 1;
  return {
    position: "absolute",
    left: -crop.left * scaleX,
    top: -crop.top * scaleY,
    width: source.size.width,
    height: source.size.height,
    transform: `scale(${String(scaleX)}, ${String(scaleY)})`,
    transformOrigin: "top left",
  };
}

function clipPath(frame: Rect, clip: Rect): string {
  const top = Math.max(0, clip.y - frame.y);
  const left = Math.max(0, clip.x - frame.x);
  const right = Math.max(0, frame.x + frame.width - clip.x - clip.width);
  const bottom = Math.max(0, frame.y + frame.height - clip.y - clip.height);
  return `inset(${String(top)}px ${String(right)}px ${String(bottom)}px ${String(left)}px)`;
}
