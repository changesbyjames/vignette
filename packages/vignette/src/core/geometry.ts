import { z } from "zod";

/** Two-dimensional dimensions in pixels. */
export const SizeSchema = z.object({ width: z.number(), height: z.number() }).readonly();
/** Two-dimensional dimensions in pixels. */
export type Size = z.output<typeof SizeSchema>;

/** Two-dimensional coordinate in pixels. */
export const PointSchema = z.object({ x: z.number(), y: z.number() }).readonly();
/** Two-dimensional coordinate in pixels. */
export type Point = z.output<typeof PointSchema>;

/** Axis-aligned rectangle in pixels. */
export const RectSchema = z
  .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
  .readonly();
/** Axis-aligned rectangle in pixels. */
export type Rect = z.output<typeof RectSchema>;

/** Distances from the four edges of a rectangle. */
export const InsetsSchema = z
  .object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() })
  .readonly();
/** Distances from the four edges of a rectangle. */
export type Insets = z.output<typeof InsetsSchema>;

/** Horizontal source alignment within a destination. */
export const HorizontalAlignmentSchema = z.enum(["left", "center", "right"]);
/** Horizontal source alignment within a destination. */
export type HorizontalAlignment = z.output<typeof HorizontalAlignmentSchema>;

/** Vertical source alignment within a destination. */
export const VerticalAlignmentSchema = z.enum(["top", "center", "bottom"]);
/** Vertical source alignment within a destination. */
export type VerticalAlignment = z.output<typeof VerticalAlignmentSchema>;

/** Horizontal and vertical alignment of source content. */
export const ContentAlignmentSchema = z
  .object({ horizontal: HorizontalAlignmentSchema, vertical: VerticalAlignmentSchema })
  .readonly();
/** Horizontal and vertical alignment of source content. */
export type ContentAlignment = z.output<typeof ContentAlignmentSchema>;

/** Insets with every edge set to zero. */
export const ZERO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Centered horizontal and vertical content alignment. */
export const CENTER_ALIGNMENT: ContentAlignment = { horizontal: "center", vertical: "center" };

/** Returns the overlap of two rectangles, or `undefined` when they do not overlap. */
export function intersectRects(first: Rect, second: Rect): Rect | undefined {
  const x = Math.max(first.x, second.x);
  const y = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);

  if (right <= x || bottom <= y) return undefined;
  return { x, y, width: right - x, height: bottom - y };
}

/** Tests whether two rectangles have identical edges. */
export function rectEquals(left: Rect, right: Rect): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

/** A content size with positive dimensions, as source props declare it. */
export const ContentSizeSchema = z
  .object({ width: z.number().positive(), height: z.number().positive() })
  .readonly();
/** A content size with positive dimensions, as source props declare it. */
export type ContentSize = z.output<typeof ContentSizeSchema>;
