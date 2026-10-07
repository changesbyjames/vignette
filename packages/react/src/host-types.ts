import type { BroadcastCanvas, ProjectId } from "@strangecyan/vignette-core";

export type HostType =
  | "broadcast"
  | "sources"
  | "scene"
  | "box"
  | "layer"
  | "scene-layer"
  | "source"
  | "browser-view";

/** Raw values accepted by React authoring primitives; core validates them before publication. */
export interface HostProps {
  readonly projectId?: unknown;
  readonly canvas?: unknown;
  readonly children?: unknown;
  readonly key?: unknown;
  readonly ref?: unknown;
  readonly definition?: unknown;
  readonly id?: unknown;
  readonly sourceId?: unknown;
  readonly sceneId?: unknown;
  readonly label?: unknown;
  readonly style?: unknown;
  readonly fit?: unknown;
  readonly alignment?: unknown;
  readonly crop?: unknown;
  readonly visible?: unknown;
  readonly opacity?: unknown;
  readonly rotation?: unknown;
  readonly url?: unknown;
  readonly viewport?: unknown;
  readonly shutdownWhenHidden?: unknown;
}

export interface HostNode {
  readonly hostId: number;
  readonly type: HostType;
  props: HostProps;
  parent: HostNode | HostContainer | null;
  readonly children: HostNode[];
  hidden: boolean;
}

export interface HostContainer {
  readonly projectId: ProjectId;
  readonly canvas: BroadcastCanvas;
  readonly children: HostNode[];
  commitRevision: number;
  commitActive: boolean;
  readonly onCommit: (revision: number) => void;
}
