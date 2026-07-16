import type { AssetRef } from "./assets.js";
import type { ContentAlignment, Insets, Rect, Size } from "./geometry.js";
import type { LayerId, ProjectId, SceneId, SourceId } from "./ids.js";
import type { AnySourceDefinition } from "./sources.js";
import type { Diagnostic } from "./diagnostics.js";

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
  readonly id: SourceId;
  readonly definition: AnySourceDefinition;
  readonly intrinsicSize?: Size;
  readonly asset?: AssetRef;
}

/** Reference to source or nested-scene content in a compiled item. */
export type CompiledItemContent =
  | { readonly kind: "source"; readonly sourceId: SourceId }
  | { readonly kind: "scene"; readonly sceneId: SceneId };

/** One absolute, target-neutral layer in a compiled scene. */
export interface CompiledItem {
  readonly id: LayerId;
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
  readonly id: SceneId;
  readonly label?: string;
  readonly items: readonly CompiledItem[];
}

/** Complete immutable desired state consumed independently by each target. */
export interface CompiledSnapshot {
  readonly revision: number;
  readonly projectId: ProjectId;
  readonly canvas: Readonly<{ width: number; height: number; frameRate?: number }>;
  readonly sources: readonly CompiledSource[];
  readonly scenes: readonly CompiledScene[];
  readonly warnings: readonly Diagnostic[];
}
