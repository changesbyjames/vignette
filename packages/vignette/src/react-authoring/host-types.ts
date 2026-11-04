import type { LayerDefinition, LayerInput } from "../core/define-layer.js";
import type { SourceHostProps } from "../core/define-source.js";
import type { Canvas, LayerProps, LayoutStyle } from "../core/snapshot.js";

/** Host element types the show renderer accepts. */
export type HostType = "show" | "scene" | "layer" | "source" | "use";

/** Props of the `show` host element rendered by `<Show>`. */
export interface ShowHostProps {
  readonly id: string;
  readonly canvas: Canvas;
  readonly activeScene?: string;
}

/** Props of the `scene` host element rendered by `<Scene>`. */
export interface SceneHostProps {
  readonly id: string;
}

/** Props of the `layer` host element rendered by `<Layer>`. */
export interface LayerHostProps extends LayerProps {
  readonly id?: string;
  readonly style?: LayoutStyle;
  /** Set by a `defineLayer` component: the kind and its raw props, validated when lowered. */
  readonly definition?: LayerDefinition;
  readonly props?: LayerInput;
}

/** Props of the `use` host element rendered by `<Use>`. */
export interface UseHostProps {
  readonly source: string;
}

/** Props of every host element, keyed by host type. */
export interface HostPropsByType {
  readonly show: ShowHostProps;
  readonly scene: SceneHostProps;
  readonly layer: LayerHostProps;
  readonly source: SourceHostProps;
  readonly use: UseHostProps;
}

/** Props of any host element; the element's `type` says which. */
export type HostProps = HostPropsByType[HostType];

interface HostNodeBase {
  readonly hostId: number;
  parent: HostNode | HostContainer | null;
  readonly children: HostNode[];
  hidden: boolean;
}

/** A mounted `<Show>`. */
export interface ShowHostNode extends HostNodeBase {
  readonly type: "show";
  props: ShowHostProps;
}

/** A mounted `<Scene>`. */
export interface SceneHostNode extends HostNodeBase {
  readonly type: "scene";
  props: SceneHostProps;
}

/** A mounted `<Layer>`. */
export interface LayerHostNode extends HostNodeBase {
  readonly type: "layer";
  props: LayerHostProps;
}

/** A mounted source component. */
export interface SourceHostNode extends HostNodeBase {
  readonly type: "source";
  props: SourceHostProps;
}

/** A mounted `<Use>`. */
export interface UseHostNode extends HostNodeBase {
  readonly type: "use";
  props: UseHostProps;
}

/** One mounted host element, discriminated by `type`. */
export type HostNode = ShowHostNode | SceneHostNode | LayerHostNode | SourceHostNode | UseHostNode;

/** The renderer root: the host tree React mutates, plus commit bookkeeping for the composer. */
export interface HostContainer {
  readonly children: HostNode[];
  commitRevision: number;
  commitActive: boolean;
  readonly onCommit: (revision: number) => void;
}
