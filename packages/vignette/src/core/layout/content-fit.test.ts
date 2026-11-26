import { describe, expect, it } from "vitest";

import type { Crop } from "../snapshot.js";
import { calculateContentPlacement } from "./content-fit.js";

describe("calculateContentPlacement", () => {
  const destination = { x: 0, y: 0, width: 800, height: 800 };
  const sourceSize = { width: 1920, height: 1080 };

  it("letterboxes contain content", () => {
    expect(calculateContentPlacement({ destination, sourceSize, fit: "contain" })).toEqual({
      ok: true,
      placement: {
        destination: { x: 0, y: 175, width: 800, height: 450 },
        sourceCrop: { top: 0, right: 0, bottom: 0, left: 0 },
        alignment: { horizontal: "center", vertical: "center" },
        fit: "contain",
      },
    });
  });

  it("crops cover content", () => {
    expect(calculateContentPlacement({ destination, sourceSize, fit: "cover" })).toEqual({
      ok: true,
      placement: {
        destination,
        sourceCrop: { top: 0, right: 420, bottom: 0, left: 420 },
        alignment: { horizontal: "center", vertical: "center" },
        fit: "cover",
      },
    });
  });

  it("names the fit only when the whole source is fitted", () => {
    const fitted = (crop?: Crop) => {
      const result = calculateContentPlacement({
        destination,
        sourceSize,
        fit: "cover",
        manualCrop: crop,
      });
      return result.ok ? result.placement.fit : "failed";
    };
    expect(fitted({ left: 0, top: 0 })).toBe("cover");
    expect(fitted({ left: 100 })).toBeUndefined();
  });
});
