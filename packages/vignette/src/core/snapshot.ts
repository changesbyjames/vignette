import { z } from "zod";

import {
  ContentAlignmentSchema,
  HorizontalAlignmentSchema,
  InsetsSchema,
  RectSchema,
  SizeSchema,
  VerticalAlignmentSchema,
} from "./geometry.js";
import { StableIdSchema } from "./ids.js";

// ---------------------------------------------------------------------------------------------
// Authoring values: what `<Show>` and `<Layer>` accept. Validated by the composer.
// ---------------------------------------------------------------------------------------------

/** Fixed output dimensions and optional frame rate of a show. */
export const CanvasSchema = z
  .object({
    width: z.number().positive(),
    height: z.number().positive(),
    frameRate: z.number().positive().optional(),
  })
  .readonly();
/** Fixed output dimensions and optional frame rate of a show. */
export type Canvas = z.output<typeof CanvasSchema>;

/** A CSS-like percentage length. */
export const PercentageSchema = z.templateLiteral([z.number(), "%"]);
/** A CSS-like percentage length. */
export type Percentage = z.output<typeof PercentageSchema>;

/** A Yoga length that always resolves to a numeric size. */
export const DefiniteLengthSchema = z.union([z.number(), PercentageSchema]);
/** A Yoga length that always resolves to a numeric size. */
export type DefiniteLength = z.output<typeof DefiniteLengthSchema>;

/** A Yoga length in pixels, percent, or automatic sizing. */
export const LengthSchema = z.union([z.number(), PercentageSchema, z.literal("auto")]);
/** A Yoga length in pixels, percent, or automatic sizing. */
export type Length = z.output<typeof LengthSchema>;

/** A non-negative Yoga length that always resolves to a numeric size: gaps and padding. */
export const SpacingSchema = z.union([z.number().nonnegative(), PercentageSchema]);
/** A non-negative Yoga length that always resolves to a numeric size: gaps and padding. */
export type Spacing = z.output<typeof SpacingSchema>;

/** One value for every edge, or individual edge values. */
function edges<T extends z.ZodType>(value: T) {
  return z.union([
    value,
    z
      .object({
        top: value.optional(),
        right: value.optional(),
        bottom: value.optional(),
        left: value.optional(),
      })
      .readonly(),
  ]);
}

/** Main-axis direction for a flex container. */
export const FlexDirectionSchema = z.enum(["row", "row-reverse", "column", "column-reverse"]);
/** Main-axis direction for a flex container. */
export type FlexDirection = z.output<typeof FlexDirectionSchema>;

/** Distribution of children along a flex container's main axis. */
export const JustifyContentSchema = z.enum([
  "flex-start",
  "center",
  "flex-end",
  "space-between",
  "space-around",
  "space-evenly",
]);
/** Distribution of children along a flex container's main axis. */
export type JustifyContent = z.output<typeof JustifyContentSchema>;

/** Cross-axis alignment accepted by Yoga layout nodes. */
export const AlignSchema = z.enum(["auto", "flex-start", "center", "flex-end", "stretch"]);
/** Cross-axis alignment accepted by Yoga layout nodes. */
export type Align = z.output<typeof AlignSchema>;

/** Margin of one or every edge. */
export const MarginSchema = edges(LengthSchema);
/** Margin of one or every edge. */
export type Margin = z.output<typeof MarginSchema>;

/** Padding of one or every edge. */
export const PaddingSchema = edges(SpacingSchema);
/** Padding of one or every edge. */
export type Padding = z.output<typeof PaddingSchema>;

/** An offset from one edge of the parent, for `top`, `right`, `bottom` and `left`. */
export const OffsetSchema = z.union([DefiniteLengthSchema, z.literal("auto")]);
/** An offset from one edge of the parent, for `top`, `right`, `bottom` and `left`. */
export type Offset = z.output<typeof OffsetSchema>;

/**
 * The Yoga flexbox properties a layer's `style` accepts, and nothing else. Names follow React
 * Native. Omitted values keep Yoga's defaults, except that `flexDirection` defaults to `column`.
 */
export const LayoutStyleSchema = z
  .object({
    width: LengthSchema.optional(),
    height: LengthSchema.optional(),
    minWidth: DefiniteLengthSchema.optional(),
    minHeight: DefiniteLengthSchema.optional(),
    maxWidth: DefiniteLengthSchema.optional(),
    maxHeight: DefiniteLengthSchema.optional(),
    aspectRatio: z.number().positive().optional(),
    margin: MarginSchema.optional(),
    padding: PaddingSchema.optional(),
    gap: SpacingSchema.optional(),
    rowGap: SpacingSchema.optional(),
    columnGap: SpacingSchema.optional(),
    flex: z.number().nonnegative().optional(),
    flexDirection: FlexDirectionSchema.optional(),
    flexGrow: z.number().nonnegative().optional(),
    flexShrink: z.number().nonnegative().optional(),
    flexBasis: LengthSchema.optional(),
    justifyContent: JustifyContentSchema.optional(),
    alignItems: AlignSchema.exclude(["auto"]).optional(),
    alignSelf: AlignSchema.optional(),
    position: z.enum(["relative", "absolute"]).optional(),
    top: OffsetSchema.optional(),
    right: OffsetSchema.optional(),
    bottom: OffsetSchema.optional(),
    left: OffsetSchema.optional(),
  })
  .strict()
  .readonly();
/** The Yoga flexbox properties a layer's `style` accepts. */
export type LayoutStyle = z.output<typeof LayoutStyleSchema>;

/** How a source's content is scaled into its layer. */
export const FitSchema = z.enum(["cover", "contain", "stretch"]);
/** How a source's content is scaled into its layer. */
export type Fit = z.output<typeof FitSchema>;

/** Where content sits inside its layer when `fit` leaves space or crops; centered by default. */
export const LayerAlignSchema = z
  .object({
    horizontal: HorizontalAlignmentSchema.optional(),
    vertical: VerticalAlignmentSchema.optional(),
  })
  .readonly();
/** Where content sits inside its layer when `fit` leaves space or crops. */
export type LayerAlign = z.output<typeof LayerAlignSchema>;

/** Pixels removed from each edge of the source before fitting. */
export const CropSchema = z
  .object({
    top: z.number().nonnegative().optional(),
    right: z.number().nonnegative().optional(),
    bottom: z.number().nonnegative().optional(),
    left: z.number().nonnegative().optional(),
  })
  .readonly();
/** Pixels removed from each edge of the source before fitting. */
export type Crop = z.output<typeof CropSchema>;

/** A layer's presentation props, apart from its `id` and `style`. */
export const LayerPropsSchema = z
  .object({
    fit: FitSchema.optional(),
    align: LayerAlignSchema.optional(),
    crop: CropSchema.optional(),
    opacity: z.number().min(0).max(1).optional(),
    rotation: z.number().optional(),
    visible: z.boolean().optional(),
  })
  .readonly();
/** A layer's presentation props, apart from its `id` and `style`. */
export type LayerProps = z.output<typeof LayerPropsSchema>;

// ---------------------------------------------------------------------------------------------
// The snapshot: immutable compiled desired state, the payload of every `update` message.
// ---------------------------------------------------------------------------------------------

/** Props of one source: whatever its kind's schema produced, as JSON. */
export const SourcePropsSchema = z.record(z.string(), z.json()).readonly();
/** Props of one source: whatever its kind's schema produced, as JSON. */
export type SourceProps = z.output<typeof SourcePropsSchema>;

/**
 * One source instance. `kind` names its `defineSource`; `props` are validated by that kind's
 * schema; `size` is the content size the kind reported for fitting.
 */
export const SourceSchema = z
  .object({
    id: StableIdSchema,
    kind: z.string().min(1),
    props: SourcePropsSchema,
    size: SizeSchema,
  })
  .readonly();
/** One source instance. */
export type Source = z.output<typeof SourceSchema>;

/** Fitted destination, source crop and alignment of one item's content. */
export const ContentPlacementSchema = z
  .object({ destination: RectSchema, sourceCrop: InsetsSchema, alignment: ContentAlignmentSchema })
  .readonly();
/** Fitted destination, source crop and alignment of one item's content. */
export type ContentPlacement = z.output<typeof ContentPlacementSchema>;

/**
 * One laid-out layer that places a source. Coordinates are absolute canvas pixels. `clip` is set
 * only when the canvas cuts the frame.
 */
export const ItemSchema = z
  .object({
    id: StableIdSchema,
    sourceId: StableIdSchema,
    frame: RectSchema,
    placement: ContentPlacementSchema,
    clip: RectSchema.optional(),
    visible: z.boolean(),
    opacity: z.number(),
    rotation: z.number(),
    /**
     * The layer kind that placed the source (`"layer"` for a plain `<Layer>`) and that kind's
     * validated props, as JSON; a target's layer plugin for the kind places the item.
     */
    kind: z.string().min(1),
    props: SourcePropsSchema,
  })
  .readonly();
/** One laid-out layer that places a source. */
export type Item = z.output<typeof ItemSchema>;

/** One compiled scene: its items in rendering order, back to front. */
export const SnapshotSceneSchema = z
  .object({ id: StableIdSchema, items: z.array(ItemSchema).readonly() })
  .readonly();
/** One compiled scene: its items in rendering order, back to front. */
export type SnapshotScene = z.output<typeof SnapshotSceneSchema>;

/** Complete immutable desired state of a show at one revision. */
export const SnapshotSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    id: StableIdSchema,
    canvas: CanvasSchema,
    activeScene: StableIdSchema.optional(),
    sources: z.array(SourceSchema).readonly(),
    scenes: z.array(SnapshotSceneSchema).readonly(),
  })
  .readonly();
/** Complete immutable desired state of a show at one revision. */
export type Snapshot = z.output<typeof SnapshotSchema>;
