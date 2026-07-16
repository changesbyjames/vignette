import { describe, expect, it } from "vitest";

import { rewriteAssetOrigin } from "./studio-obs.js";

describe("OBS worker asset origin", () => {
  it("keeps the public asset path while using the worker's internal origin", () => {
    expect(
      rewriteAssetOrigin(
        "http://127.0.0.1:4173/assets/streamborder6cam.png?version=1",
        "http://vignette-host:4173",
      ),
    ).toBe("http://vignette-host:4173/assets/streamborder6cam.png?version=1");
  });

  it("rejects an asset origin with a path", () => {
    expect(() =>
      rewriteAssetOrigin("http://127.0.0.1:4173/assets/example.png", "http://host/internal"),
    ).toThrow("VIGNETTE_ASSET_ORIGIN must be an HTTP(S) origin without a path.");
  });
});
