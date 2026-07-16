import {
  Align as YogaAlign,
  BoxSizing,
  Edge,
  FlexDirection as YogaFlexDirection,
  Gutter,
  Justify,
  Overflow,
  PositionType,
  type Node as YogaNode,
} from "yoga-layout";

import type { Align, Edges, LayoutStyle, Length } from "../authoring.js";

export function applyLayoutStyle(node: YogaNode, style: LayoutStyle | undefined): void {
  node.setBoxSizing(BoxSizing.BorderBox);
  node.setFlexDirection(YogaFlexDirection.Column);
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
        row: YogaFlexDirection.Row,
        "row-reverse": YogaFlexDirection.RowReverse,
        column: YogaFlexDirection.Column,
        "column-reverse": YogaFlexDirection.ColumnReverse,
      }[style.flexDirection],
    );
  }

  if (style.justifyContent !== undefined) {
    node.setJustifyContent(
      {
        "flex-start": Justify.FlexStart,
        center: Justify.Center,
        "flex-end": Justify.FlexEnd,
        "space-between": Justify.SpaceBetween,
        "space-around": Justify.SpaceAround,
        "space-evenly": Justify.SpaceEvenly,
      }[style.justifyContent],
    );
  }

  if (style.alignItems !== undefined) node.setAlignItems(toYogaAlign(style.alignItems));
  if (style.alignSelf !== undefined) node.setAlignSelf(toYogaAlign(style.alignSelf));

  if (style.position !== undefined) {
    node.setPositionType(
      style.position === "absolute" ? PositionType.Absolute : PositionType.Relative,
    );
  }

  if (style.overflow !== undefined) {
    node.setOverflow(style.overflow === "hidden" ? Overflow.Hidden : Overflow.Visible);
  }

  if (style.gap !== undefined) node.setGap(Gutter.All, style.gap);
  if (style.rowGap !== undefined) node.setGap(Gutter.Row, style.rowGap);
  if (style.columnGap !== undefined) node.setGap(Gutter.Column, style.columnGap);

  applyEdges(style.margin, (edge, value) => {
    node.setMargin(edge, value);
  });
  applyEdges(style.padding, (edge, value) => {
    if (value !== "auto") node.setPadding(edge, value);
  });
  applyEdges(style.inset, (edge, value) => {
    if (value === "auto") node.setPositionAuto(edge);
    else node.setPosition(edge, value);
  });
}

function applyEdges(
  edges: Edges<Length> | undefined,
  apply: (edge: Edge, value: Length) => void,
): void {
  if (edges === undefined) return;
  if (typeof edges === "number" || typeof edges === "string") {
    apply(Edge.All, edges);
    return;
  }

  if (edges.left !== undefined) apply(Edge.Left, edges.left);
  if (edges.top !== undefined) apply(Edge.Top, edges.top);
  if (edges.right !== undefined) apply(Edge.Right, edges.right);
  if (edges.bottom !== undefined) apply(Edge.Bottom, edges.bottom);
}

function toYogaAlign(align: Align): YogaAlign {
  return {
    auto: YogaAlign.Auto,
    "flex-start": YogaAlign.FlexStart,
    center: YogaAlign.Center,
    "flex-end": YogaAlign.FlexEnd,
    stretch: YogaAlign.Stretch,
  }[align];
}
