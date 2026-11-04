import type { Node as YogaNode, Yoga } from "yoga-layout/load";

import type { Align, LayoutStyle, Length, Margin, Offset } from "../snapshot.js";

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
  if (style.flex !== undefined) node.setFlex(style.flex);
  node.setFlexGrow(style.flexGrow);
  node.setFlexShrink(style.flexShrink);
  node.setFlexBasis(style.flexBasis);

  applyFlexAlignment(yoga, node, style);
  applySpacing(yoga, node, style);
}

/** Translate flex choices through Yoga constants, leaving omitted values at Yoga defaults. */
function applyFlexAlignment(yoga: Yoga, node: YogaNode, style: LayoutStyle): void {
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
}

/** Yoga owns gaps, edges, and positioning; targets only consume the resulting absolute geometry. */
function applySpacing(yoga: Yoga, node: YogaNode, style: LayoutStyle): void {
  if (style.position !== undefined) {
    node.setPositionType(
      style.position === "absolute" ? yoga.POSITION_TYPE_ABSOLUTE : yoga.POSITION_TYPE_RELATIVE,
    );
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
  const offset = (edge: YogaEdge, value: Offset | undefined) => {
    if (value === undefined) return;
    if (value === "auto") node.setPositionAuto(edge);
    else node.setPosition(edge, value);
  };
  offset(yoga.EDGE_TOP, style.top);
  offset(yoga.EDGE_RIGHT, style.right);
  offset(yoga.EDGE_BOTTOM, style.bottom);
  offset(yoga.EDGE_LEFT, style.left);
}

type YogaEdge = Parameters<YogaNode["setMargin"]>[0];

function applyEdges(
  yoga: Yoga,
  edges: Margin | undefined,
  apply: (edge: YogaEdge, value: Length) => void,
): void {
  if (edges === undefined) return;
  if (Object(edges) !== edges) {
    // SAFETY: The closed edge union contains only scalar Lengths or an edge map; boxing changes only a scalar.
    apply(yoga.EDGE_ALL, edges as Length);
    return;
  }

  // SAFETY: Scalar Lengths returned above, leaving the edge-map member of the closed union.
  const map = edges as Exclude<Margin, Length>;
  if (map.left !== undefined) apply(yoga.EDGE_LEFT, map.left);
  if (map.top !== undefined) apply(yoga.EDGE_TOP, map.top);
  if (map.right !== undefined) apply(yoga.EDGE_RIGHT, map.right);
  if (map.bottom !== undefined) apply(yoga.EDGE_BOTTOM, map.bottom);
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
