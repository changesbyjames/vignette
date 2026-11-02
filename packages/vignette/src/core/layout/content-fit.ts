import {
  CENTER_ALIGNMENT,
  type ContentAlignment,
  type Insets,
  type Rect,
  type Size,
} from "../geometry.js";
import type { ContentPlacement, Crop, Fit } from "../snapshot.js";
import { roundInsets, roundRect } from "./rounding.js";

interface ContentFitSuccess {
  readonly ok: true;
  readonly placement: ContentPlacement;
}

interface ContentFitFailure {
  readonly ok: false;
  readonly message: string;
}

/** Source and destination geometry used for content fitting. */
export interface ContentFitInput {
  readonly destination: Rect;
  readonly sourceSize: Size;
  readonly fit: Fit;
  readonly alignment?: ContentAlignment;
  readonly manualCrop?: Crop;
}

/** A calculated placement or an explanation of invalid fitting inputs. */
export type ContentFitResult = ContentFitSuccess | ContentFitFailure;

/** Calculates deterministic contain, cover, or stretch placement and crop geometry. */
export function calculateContentPlacement(input: ContentFitInput): ContentFitResult {
  const alignment = input.alignment ?? CENTER_ALIGNMENT;
  const crop = completeCrop(input.manualCrop);

  if (input.destination.width <= 0 || input.destination.height <= 0) {
    return { ok: false, message: "Destination dimensions must be positive." };
  }

  const sourceSize = input.sourceSize;
  if (sourceSize.width <= 0 || sourceSize.height <= 0) {
    return { ok: false, message: "Source dimensions must be positive." };
  }

  return calculateSizedPlacement(input, sourceSize, crop, alignment);
}

/** Fit a source's remaining area after manual crop, then distribute unused space by alignment. */
function calculateSizedPlacement(
  input: ContentFitInput,
  sourceSize: Size,
  crop: Insets,
  alignment: ContentAlignment,
): ContentFitResult {
  const effectiveWidth = sourceSize.width - crop.left - crop.right;
  const effectiveHeight = sourceSize.height - crop.top - crop.bottom;
  if (effectiveWidth <= 0 || effectiveHeight <= 0) {
    return { ok: false, message: "Manual crop removes the complete source area." };
  }

  if (input.fit === "stretch") {
    return {
      ok: true,
      placement: {
        destination: roundRect(input.destination),
        sourceCrop: roundInsets(crop),
        alignment,
      },
    };
  }

  const scaleX = input.destination.width / effectiveWidth;
  const scaleY = input.destination.height / effectiveHeight;

  if (input.fit === "contain") {
    const scale = Math.min(scaleX, scaleY);
    const width = effectiveWidth * scale;
    const height = effectiveHeight * scale;
    return {
      ok: true,
      placement: {
        destination: roundRect({
          x: input.destination.x + (input.destination.width - width) * horizontalFactor(alignment),
          y: input.destination.y + (input.destination.height - height) * verticalFactor(alignment),
          width,
          height,
        }),
        sourceCrop: roundInsets(crop),
        alignment,
      },
    };
  }

  const scale = Math.max(scaleX, scaleY);
  const visibleWidth = input.destination.width / scale;
  const visibleHeight = input.destination.height / scale;
  const horizontalCrop = effectiveWidth - visibleWidth;
  const verticalCrop = effectiveHeight - visibleHeight;
  const horizontal = horizontalFactor(alignment);
  const vertical = verticalFactor(alignment);

  return {
    ok: true,
    placement: {
      destination: roundRect(input.destination),
      sourceCrop: roundInsets({
        left: crop.left + horizontalCrop * horizontal,
        right: crop.right + horizontalCrop * (1 - horizontal),
        top: crop.top + verticalCrop * vertical,
        bottom: crop.bottom + verticalCrop * (1 - vertical),
      }),
      alignment,
    },
  };
}

/** Supply zero for omitted crop edges so subsequent fitting uses a complete inset tuple. */
function completeCrop(crop: Crop | undefined): Insets {
  return {
    top: crop?.top ?? 0,
    right: crop?.right ?? 0,
    bottom: crop?.bottom ?? 0,
    left: crop?.left ?? 0,
  };
}

function horizontalFactor(alignment: ContentAlignment): number {
  return { left: 0, center: 0.5, right: 1 }[alignment.horizontal];
}

function verticalFactor(alignment: ContentAlignment): number {
  return { top: 0, center: 0.5, bottom: 1 }[alignment.vertical];
}
