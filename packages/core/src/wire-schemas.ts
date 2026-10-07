import { z } from "zod";

import { isStableId, STABLE_ID_RULE } from "./ids.js";
import { omitUndefined } from "./objects.js";
import { validateResourceUrl } from "./resource-url.js";
import type { CompiledSnapshot } from "./snapshot.js";
import type { AssetManifest, RuntimeEvent, RuntimeSetup } from "./runtime.js";

/** Stable resource identifier; malformed IDs fail decoding instead of throwing. */
export const StableIdWireSchema = z.string().refine(isStableId, STABLE_ID_RULE);
export type StableIdWire = z.output<typeof StableIdWireSchema>;

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
    id: StableIdWireSchema,
    kind: z.templateLiteral(["source:", z.string()]),
    label: z.string().optional(),
  })
  .catchall(z.json())
  .transform(omitUndefined);
export type SourceDefinitionWire = z.output<typeof SourceDefinitionWireSchema>;
export const CompiledSourceWireSchema = z
  .object({
    id: StableIdWireSchema,
    definition: SourceDefinitionWireSchema,
    intrinsicSize: SizeWireSchema.optional(),
    asset: AssetRefWireSchema.optional(),
  })
  .transform(omitUndefined);
export type CompiledSourceWire = z.output<typeof CompiledSourceWireSchema>;
export const ItemContentWireSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("source"), sourceId: StableIdWireSchema }),
  z.object({ kind: z.literal("scene"), sceneId: StableIdWireSchema }),
]);
export type ItemContentWire = z.output<typeof ItemContentWireSchema>;
export const CompiledItemWireSchema = z
  .object({
    id: StableIdWireSchema,
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
    id: StableIdWireSchema,
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
  projectId: StableIdWireSchema,
  canvas: CanvasWireSchema,
  sources: z.array(CompiledSourceWireSchema),
  scenes: z.array(CompiledSceneWireSchema),
  warnings: z.array(DiagnosticWireSchema),
}) satisfies z.ZodType<CompiledSnapshot>;
export type CompiledSnapshotWire = z.output<typeof CompiledSnapshotWireSchema>;
export const ManifestEntryWireSchema = z
  .object({
    name: z.string(),
    /** Absolute HTTP(S) or root-relative; targets resolve root-relative URLs against their base. */
    url: z
      .string()
      .refine(
        (url) => validateResourceUrl(url) === undefined,
        "Asset URL must be an absolute HTTP(S) URL or a root-relative path starting with a single '/'.",
      ),
    integrity: z.templateLiteral(["sha256-", z.string()]).optional(),
  })
  .transform(omitUndefined);
export type ManifestEntryWire = z.output<typeof ManifestEntryWireSchema>;
export const AssetManifestWireSchema = z.object({
  version: z.union([z.literal(1), z.templateLiteral(["sha256-", z.string()])]),
  assets: z.array(ManifestEntryWireSchema),
}) satisfies z.ZodType<AssetManifest>;
export type AssetManifestWire = z.output<typeof AssetManifestWireSchema>;
/** Target entrypoint hints for one advertised extension source kind. */
export const SourceModuleEntrypointsWireSchema = z
  .object({ dom: z.string().optional(), obs: z.string().optional() })
  .transform(omitUndefined);
/** Decoded target entrypoint hints. */
export type SourceModuleEntrypointsWire = z.output<typeof SourceModuleEntrypointsWireSchema>;
/** One extension source kind advertised by a composer's setup message. */
export const ExtensionSourceKindWireSchema = z
  .object({
    kind: z.templateLiteral(["source:", z.string()]),
    entrypoints: SourceModuleEntrypointsWireSchema.optional(),
  })
  .transform(omitUndefined);
/** Decoded extension source kind. */
export type ExtensionSourceKindWire = z.output<typeof ExtensionSourceKindWireSchema>;
/** Setup payload: project identity, asset manifest, and the extension kinds the stream requires. */
export const RuntimeSetupWireSchema = z.object({
  projectId: StableIdWireSchema,
  manifest: AssetManifestWireSchema,
  extensions: z.array(ExtensionSourceKindWireSchema),
}) satisfies z.ZodType<RuntimeSetup>;
/** Decoded setup payload. */
export type RuntimeSetupWire = z.output<typeof RuntimeSetupWireSchema>;
export const RuntimeEventWireSchema = z.object({
  id: z.string(),
  kind: z.literal("scene:select"),
  sceneId: StableIdWireSchema,
}) satisfies z.ZodType<RuntimeEvent>;
export type RuntimeEventWire = z.output<typeof RuntimeEventWireSchema>;
