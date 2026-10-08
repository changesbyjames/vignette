import type { AssetRef } from "./assets.js";
import type { ContentAlignment, Insets, Rect, Size } from "./geometry.js";
import type { AnySourceDefinition } from "./sources.js";
import type { Diagnostic } from "./diagnostics.js";

interface CompiledSourceContent {
  readonly kind: "source";
  readonly sourceId: string;
}

interface CompiledSceneContent {
  readonly kind: "scene";
  readonly sceneId: string;
}

interface CompiledSnapshotCanvas {
  width: number;
  height: number;
  frameRate?: number;
}

/** Fitted destination, source crop, and alignment for one source layer. */
export interface ContentPlacement {
  readonly destination: Rect;
  readonly sourceCrop: Insets;
  readonly alignment: ContentAlignment;
}

/**
 * One compiled source with the module-derived metadata targets need to stay kind-agnostic:
 * the intrinsic content size and the asset that must be resolved before rendering.
 */
export interface CompiledSource {
  readonly id: string;
  readonly definition: AnySourceDefinition;
  readonly intrinsicSize?: Size;
  readonly asset?: AssetRef;
}

/** Reference to source or nested-scene content in a compiled item. */
export type CompiledItemContent = CompiledSourceContent | CompiledSceneContent;

/** One absolute, target-neutral layer in a compiled scene. */
export interface CompiledItem {
  readonly id: string;
  readonly content: CompiledItemContent;
  readonly frame: Rect;
  readonly clip?: Rect;
  readonly placement?: ContentPlacement;
  readonly visible: boolean;
  readonly opacity: number;
  readonly rotation: number;
}

/** Compiled scene with its layers in rendering order. */
export interface CompiledScene {
  readonly id: string;
  readonly label?: string;
  readonly items: readonly CompiledItem[];
}

/** Complete immutable desired state consumed independently by each target. */
export interface CompiledSnapshot {
  readonly revision: number;
  readonly projectId: string;
  readonly canvas: Readonly<CompiledSnapshotCanvas>;
  readonly sources: readonly CompiledSource[];
  readonly scenes: readonly CompiledScene[];
  readonly warnings: readonly Diagnostic[];
}
