import type { Node as YogaNode, Yoga } from "yoga-layout/load";

import type { Align, Edges, LayoutStyle, Length } from "../authoring.js";

export function applyLayoutStyle(yoga: Yoga, node: YogaNode, style: LayoutStyle | undefined): void {
  node.setBoxSizing(yoga.BOX_SIZING_BORDER_BOX);
  node.setFlexDirection(yoga.FLEX_DIRECTION_COLUMN);
  if (style === undefined) return;

  node.setWidth(style.width);
  node.setHeight(style.height);
  node.setMinWidth(style.minWidth);
  node.setMinHeight(style.minHeight);
  node.setMaxWidth(style.maxWidth);
  node.setMaxHeight(style.maxHeight);
  node.setAspectRatio(style.aspectRatio);
  node.setFlexGrow(style.flexGrow);
  node.setFlexShrink(style.flexShrink);
  node.setFlexBasis(style.flexBasis);

  if (style.flexDirection !== undefined) {
    node.setFlexDirection(
      {
        row: yoga.FLEX_DIRECTION_ROW,
        "row-reverse": yoga.FLEX_DIRECTION_ROW_REVERSE,
        column: yoga.FLEX_DIRECTION_COLUMN,
        "column-reverse": yoga.FLEX_DIRECTION_COLUMN_REVERSE,
      }[style.flexDirection],
    );
  }

  if (style.justifyContent !== undefined) {
    node.setJustifyContent(
      {
        "flex-start": yoga.JUSTIFY_FLEX_START,
        center: yoga.JUSTIFY_CENTER,
        "flex-end": yoga.JUSTIFY_FLEX_END,
        "space-between": yoga.JUSTIFY_SPACE_BETWEEN,
        "space-around": yoga.JUSTIFY_SPACE_AROUND,
        "space-evenly": yoga.JUSTIFY_SPACE_EVENLY,
      }[style.justifyContent],
    );
  }

  if (style.alignItems !== undefined) node.setAlignItems(toYogaAlign(yoga, style.alignItems));
  if (style.alignSelf !== undefined) node.setAlignSelf(toYogaAlign(yoga, style.alignSelf));

  if (style.position !== undefined) {
    node.setPositionType(
      style.position === "absolute" ? yoga.POSITION_TYPE_ABSOLUTE : yoga.POSITION_TYPE_RELATIVE,
    );
  }

  if (style.overflow !== undefined) {
    node.setOverflow(style.overflow === "hidden" ? yoga.OVERFLOW_HIDDEN : yoga.OVERFLOW_VISIBLE);
  }

  if (style.gap !== undefined) node.setGap(yoga.GUTTER_ALL, style.gap);
  if (style.rowGap !== undefined) node.setGap(yoga.GUTTER_ROW, style.rowGap);
  if (style.columnGap !== undefined) node.setGap(yoga.GUTTER_COLUMN, style.columnGap);

  applyEdges(yoga, style.margin, (edge, value) => {
    node.setMargin(edge, value);
  });
  applyEdges(yoga, style.padding, (edge, value) => {
    if (value !== "auto") node.setPadding(edge, value);
  });
  applyEdges(yoga, style.inset, (edge, value) => {
    if (value === "auto") node.setPositionAuto(edge);
    else node.setPosition(edge, value);
  });
}

function applyEdges(
  yoga: Yoga,
  edges: Edges<Length> | undefined,
  apply: (edge: Parameters<YogaNode["setMargin"]>[0], value: Length) => void,
): void {
  if (edges === undefined) return;
  if (typeof edges === "number" || typeof edges === "string") {
    apply(yoga.EDGE_ALL, edges);
    return;
  }

  if (edges.left !== undefined) apply(yoga.EDGE_LEFT, edges.left);
  if (edges.top !== undefined) apply(yoga.EDGE_TOP, edges.top);
  if (edges.right !== undefined) apply(yoga.EDGE_RIGHT, edges.right);
  if (edges.bottom !== undefined) apply(yoga.EDGE_BOTTOM, edges.bottom);
}

function toYogaAlign(yoga: Yoga, align: Align): Parameters<YogaNode["setAlignItems"]>[0] {
  return {
    auto: yoga.ALIGN_AUTO,
    "flex-start": yoga.ALIGN_FLEX_START,
    center: yoga.ALIGN_CENTER,
    "flex-end": yoga.ALIGN_FLEX_END,
    stretch: yoga.ALIGN_STRETCH,
  }[align];
}
