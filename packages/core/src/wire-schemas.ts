import { z } from "zod";

import { layerId, projectId, sceneId, sourceId } from "./ids.js";
import { omitUndefined } from "./objects.js";
import type { CompiledSnapshot } from "./snapshot.js";
import type { AssetManifest, RuntimeEvent } from "./runtime.js";

export const SizeWireSchema = z.object({ width: z.number(), height: z.number() });
export type SizeWire = z.output<typeof SizeWireSchema>;
export const RectWireSchema = SizeWireSchema.extend({ x: z.number(), y: z.number() });
export type RectWire = z.output<typeof RectWireSchema>;
export const InsetsWireSchema = z.object({
  top: z.number(),
  right: z.number(),
  bottom: z.number(),
  left: z.number(),
});
export type InsetsWire = z.output<typeof InsetsWireSchema>;
export const AlignmentWireSchema = z.object({
  horizontal: z.enum(["left", "center", "right"]),
  vertical: z.enum(["top", "center", "bottom"]),
});
export type AlignmentWire = z.output<typeof AlignmentWireSchema>;
export const PlacementWireSchema = z.object({
  destination: RectWireSchema,
  sourceCrop: InsetsWireSchema,
  alignment: AlignmentWireSchema,
});
export type PlacementWire = z.output<typeof PlacementWireSchema>;
export const AssetRefWireSchema = z.object({ kind: z.literal("asset"), name: z.string() });
export type AssetRefWire = z.output<typeof AssetRefWireSchema>;

/** Preserve extension-owned settings while decoding the shared source identity. */
export const SourceDefinitionWireSchema = z
  .object({
    id: z.string().transform(sourceId),
    kind: z.templateLiteral(["source:", z.string()]),
    label: z.string().optional(),
  })
  .catchall(z.json())
  .transform(omitUndefined);
export type SourceDefinitionWire = z.output<typeof SourceDefinitionWireSchema>;
export const CompiledSourceWireSchema = z
  .object({
    id: z.string().transform(sourceId),
    definition: SourceDefinitionWireSchema,
    intrinsicSize: SizeWireSchema.optional(),
    asset: AssetRefWireSchema.optional(),
  })
  .transform(omitUndefined);
export type CompiledSourceWire = z.output<typeof CompiledSourceWireSchema>;
export const ItemContentWireSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("source"), sourceId: z.string().transform(sourceId) }),
  z.object({ kind: z.literal("scene"), sceneId: z.string().transform(sceneId) }),
]);
export type ItemContentWire = z.output<typeof ItemContentWireSchema>;
export const CompiledItemWireSchema = z
  .object({
    id: z.string().transform(layerId),
    content: ItemContentWireSchema,
    frame: RectWireSchema,
    clip: RectWireSchema.optional(),
    placement: PlacementWireSchema.optional(),
    visible: z.boolean(),
    opacity: z.number(),
    rotation: z.number(),
  })
  .transform(omitUndefined);
export type CompiledItemWire = z.output<typeof CompiledItemWireSchema>;
export const CompiledSceneWireSchema = z
  .object({
    id: z.string().transform(sceneId),
    label: z.string().optional(),
    items: z.array(CompiledItemWireSchema),
  })
  .transform(omitUndefined);
export type CompiledSceneWire = z.output<typeof CompiledSceneWireSchema>;
export const DiagnosticWireSchema = z
  .object({
    code: z.enum([
      "INVALID_PROJECT_ID",
      "INVALID_SCENE_ID",
      "INVALID_SOURCE_ID",
      "INVALID_LAYER_ID",
      "INVALID_CANVAS",
      "INVALID_LAYOUT_VALUE",
      "LAYOUT_COMPILE_FAILED",
      "INVALID_ASSET_NAME",
      "INVALID_BROWSER_URL",
      "INVALID_SOURCE_SIZE",
      "INVALID_SOURCE_SETTING",
      "UNKNOWN_SOURCE_KIND",
      "DUPLICATE_SCENE_ID",
      "DUPLICATE_SOURCE_ID",
      "DUPLICATE_LAYER_ID",
      "MISSING_SOURCE",
      "MISSING_SCENE",
      "SCENE_CYCLE",
      "V1_REPEATED_PLACEMENT",
      "TARGET_LAYOUT_DIVERGENCE",
      "UNREACHABLE_SOURCE",
      "UNSUPPORTED_TARGET_CAPABILITY",
    ]),
    severity: z.enum(["warning", "error"]),
    message: z.string(),
    path: z.string(),
    relatedIds: z.array(z.string()).optional(),
  })
  .transform(omitUndefined);
export type DiagnosticWire = z.output<typeof DiagnosticWireSchema>;
export const CanvasWireSchema = z
  .object({
    width: z.number().positive(),
    height: z.number().positive(),
    frameRate: z.number().optional(),
  })
  .transform(omitUndefined);
export type CanvasWire = z.output<typeof CanvasWireSchema>;
export const CompiledSnapshotWireSchema = z.object({
  revision: z.number(),
  projectId: z.string().transform(projectId),
  canvas: CanvasWireSchema,
  sources: z.array(CompiledSourceWireSchema),
  scenes: z.array(CompiledSceneWireSchema),
  warnings: z.array(DiagnosticWireSchema),
}) satisfies z.ZodType<CompiledSnapshot>;
export type CompiledSnapshotWire = z.output<typeof CompiledSnapshotWireSchema>;
export const ManifestEntryWireSchema = z
  .object({
    name: z.string(),
    url: z.string(),
    integrity: z.templateLiteral(["sha256-", z.string()]).optional(),
  })
  .transform(omitUndefined);
export type ManifestEntryWire = z.output<typeof ManifestEntryWireSchema>;
export const AssetManifestWireSchema = z.object({
  version: z.union([z.literal(1), z.templateLiteral(["sha256-", z.string()])]),
  assets: z.array(ManifestEntryWireSchema),
}) satisfies z.ZodType<AssetManifest>;
export type AssetManifestWire = z.output<typeof AssetManifestWireSchema>;
export const RuntimeEventWireSchema = z.object({
  id: z.string(),
  kind: z.literal("scene:select"),
  sceneId: z.string().transform(sceneId),
}) satisfies z.ZodType<RuntimeEvent>;
export type RuntimeEventWire = z.output<typeof RuntimeEventWireSchema>;
