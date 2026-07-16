import { describe, expect, it } from "vitest";

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
      },
    });
  });
});
