import { createElement, type ReactElement, type ReactNode } from "react";

import type { LayerHostProps, SceneHostProps, ShowHostProps, UseHostProps } from "./host-types.js";

/** React children accepted by show primitives. */
export interface ChildrenProps {
  readonly children?: ReactNode;
}

/** Props of `<Show>`: the show's ID, canvas and optionally the scene targets should show. */
export interface ShowProps extends ShowHostProps, ChildrenProps {}

/**
 * The root of a show. Its children are scenes and shared sources: a source declared here with an
 * `id` is one live instance that any scene can place with `<Use>`.
 */
export function Show(props: ShowProps): ReactElement {
  const { children, ...host } = props;
  const element: ShowHostProps = host;
  return createElement("show", element, children);
}

/** Props of `<Scene>`. */
export interface SceneProps extends SceneHostProps, ChildrenProps {}

/** One scene of a show: a flex container of layers filling the canvas. */
export function Scene(props: SceneProps): ReactElement {
  const { children, ...host } = props;
  const element: SceneHostProps = host;
  return createElement("scene", element, children);
}

/**
 * Props of `<Layer>`: Yoga `style`, how its content is fitted (`fit`, `align`, `crop`), its
 * presentation (`opacity`, `rotation`, `visible`) and an optional explicit `id`.
 */
export interface LayerElementProps extends LayerHostProps, ChildrenProps {}

/**
 * A layer either places one source or groups other layers for layout. Only layers that place a
 * source become objects in a target; groups are virtual flex boxes.
 */
export function Layer(props: LayerElementProps): ReactElement {
  const { children, ...host } = props;
  const element: LayerHostProps = host;
  return createElement("layer", element, children);
}

/** Props of `<Use>`: the ID of the shared source to place. */
export type UseProps = UseHostProps;

/** Places a shared source, declared at show level with an `id`, in the enclosing layer. */
export function Use(props: UseProps): ReactElement {
  const element: UseHostProps = { source: props.source };
  return createElement("use", element);
}
