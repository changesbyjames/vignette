export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect extends Point, Size {}

export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export type HorizontalAlignment = "left" | "center" | "right";
export type VerticalAlignment = "top" | "center" | "bottom";

export interface ContentAlignment {
  readonly horizontal: HorizontalAlignment;
  readonly vertical: VerticalAlignment;
}

export const ZERO_INSETS: Insets = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

export const CENTER_ALIGNMENT: ContentAlignment = {
  horizontal: "center",
  vertical: "center",
};

export function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

export function isPositiveSize(size: Size): boolean {
  return (
    isFiniteNumber(size.width) && isFiniteNumber(size.height) && size.width > 0 && size.height > 0
  );
}

export function intersectRects(first: Rect, second: Rect): Rect | undefined {
  const x = Math.max(first.x, second.x);
  const y = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);

  if (right <= x || bottom <= y) return undefined;
  return { x, y, width: right - x, height: bottom - y };
}
