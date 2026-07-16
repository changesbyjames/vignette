import type { FitMode } from "../authoring.js";
import {
  CENTER_ALIGNMENT,
  ZERO_INSETS,
  type ContentAlignment,
  type Insets,
  type Rect,
  type Size,
} from "../geometry.js";
import type { ContentPlacement } from "../snapshot.js";
import { roundInsets, roundRect } from "./rounding.js";

export interface ContentFitInput {
  readonly destination: Rect;
  readonly sourceSize?: Size;
  readonly fit: FitMode;
  readonly alignment?: ContentAlignment;
  readonly manualCrop?: Partial<Insets>;
}

export type ContentFitResult =
  | { readonly ok: true; readonly placement: ContentPlacement }
  | { readonly ok: false; readonly message: string };

export function calculateContentPlacement(input: ContentFitInput): ContentFitResult {
  const alignment = input.alignment ?? CENTER_ALIGNMENT;
  const crop = completeCrop(input.manualCrop);

  if (input.destination.width <= 0 || input.destination.height <= 0) {
    return { ok: false, message: "Destination dimensions must be positive." };
  }

  if (input.fit === "fill" && input.sourceSize === undefined) {
    if (hasCrop(crop)) {
      return { ok: false, message: "Manual crop requires declared source dimensions." };
    }
    return {
      ok: true,
      placement: {
        destination: roundRect(input.destination),
        sourceCrop: ZERO_INSETS,
        alignment,
      },
    };
  }

  const sourceSize = input.sourceSize;
  if (sourceSize === undefined || sourceSize.width <= 0 || sourceSize.height <= 0) {
    return { ok: false, message: `${input.fit} fitting requires declared source dimensions.` };
  }

  const effectiveWidth = sourceSize.width - crop.left - crop.right;
  const effectiveHeight = sourceSize.height - crop.top - crop.bottom;
  if (effectiveWidth <= 0 || effectiveHeight <= 0) {
    return { ok: false, message: "Manual crop removes the complete source area." };
  }

  if (input.fit === "fill") {
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

function completeCrop(crop: Partial<Insets> | undefined): Insets {
  return {
    top: crop?.top ?? 0,
    right: crop?.right ?? 0,
    bottom: crop?.bottom ?? 0,
    left: crop?.left ?? 0,
  };
}

function hasCrop(crop: Insets): boolean {
  return crop.top !== 0 || crop.right !== 0 || crop.bottom !== 0 || crop.left !== 0;
}

function horizontalFactor(alignment: ContentAlignment): number {
  return { left: 0, center: 0.5, right: 1 }[alignment.horizontal];
}

function verticalFactor(alignment: ContentAlignment): number {
  return { top: 0, center: 0.5, bottom: 1 }[alignment.vertical];
}
