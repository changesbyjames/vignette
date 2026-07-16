/** Two-dimensional dimensions in pixels. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Two-dimensional coordinate in pixels. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Axis-aligned rectangle in pixels. */
export interface Rect extends Point, Size {}

/** Distances from the four edges of a rectangle. */
export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** Horizontal source alignment within a destination. */
export type HorizontalAlignment = "left" | "center" | "right";
/** Vertical source alignment within a destination. */
export type VerticalAlignment = "top" | "center" | "bottom";

/** Horizontal and vertical alignment of source content. */
export interface ContentAlignment {
  readonly horizontal: HorizontalAlignment;
  readonly vertical: VerticalAlignment;
}

/** Insets with every edge set to zero. */
export const ZERO_INSETS: Insets = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

/** Centered horizontal and vertical content alignment. */
export const CENTER_ALIGNMENT: ContentAlignment = {
  horizontal: "center",
  vertical: "center",
};

/** Tests whether a number is finite. */
export function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

/** Tests whether both dimensions are finite and greater than zero. */
export function isPositiveSize(size: Size): boolean {
  return (
    isFiniteNumber(size.width) && isFiniteNumber(size.height) && size.width > 0 && size.height > 0
  );
}

/** Returns the overlap of two rectangles, or `undefined` when they do not overlap. */
export function intersectRects(first: Rect, second: Rect): Rect | undefined {
  const x = Math.max(first.x, second.x);
  const y = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);

  if (right <= x || bottom <= y) return undefined;
  return { x, y, width: right - x, height: bottom - y };
}
