import type { AssetRef } from "./assets.js";
import type { ContentAlignment, Insets, Rect, Size } from "./geometry.js";
import type { LayerId, ProjectId, SceneId, SourceId } from "./ids.js";
import type { AnySourceDefinition } from "./sources.js";
import type { Diagnostic } from "./diagnostics.js";

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

export type CompiledItemContent =
  | { readonly kind: "source"; readonly sourceId: SourceId }
  | { readonly kind: "scene"; readonly sceneId: SceneId };

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

export interface CompiledScene {
  readonly id: SceneId;
  readonly label?: string;
  readonly items: readonly CompiledItem[];
}

export interface CompiledSnapshot {
  readonly revision: number;
  readonly projectId: ProjectId;
  readonly canvas: Readonly<{ width: number; height: number; frameRate?: number }>;
  readonly sources: readonly CompiledSource[];
  readonly scenes: readonly CompiledScene[];
  readonly warnings: readonly Diagnostic[];
}
