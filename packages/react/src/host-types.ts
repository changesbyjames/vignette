import type { BroadcastCanvas, ProjectId } from "@cbj/vignette-core";

export type HostType =
  "broadcast" | "sources" | "scene" | "box" | "layer" | "scene-layer" | "source" | "browser-view";

export interface HostNode {
  readonly hostId: number;
  readonly type: HostType;
  props: Readonly<Record<string, unknown>>;
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
