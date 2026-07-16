import type { LayoutStyle } from "@cbj/react-obs-core";

/** Fixed-canvas placement shared by camera layers and transparent overlays. */
export function tile(left: number, top: number, width: number, height: number): LayoutStyle {
  return {
    position: "absolute",
    inset: { left, top },
    width,
    height,
  };
}
