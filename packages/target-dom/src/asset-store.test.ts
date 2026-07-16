// @vitest-environment jsdom

import { asset } from "@cbj/react-obs-core";
import { describe, expect, it, vi } from "vitest";

import { DomAssetStore } from "./asset-store.js";

describe("DomAssetStore", () => {
  it("downloads named assets and exposes browser-owned blob URLs", async () => {
    const revoked: string[] = [];
    const store = new DomAssetStore({
      fetch: vi.fn(() => Promise.resolve(new Response(new Blob(["image-bytes"]), { status: 200 }))),
      createObjectURL: () => "blob:react-obs/background",
      revokeObjectURL: (url) => revoked.push(url),
    });

    await store.setup({
      version: 1,
      assets: [{ name: "background.png", url: "https://assets.example/background.png" }],
    });

    await expect(store.resolve(asset("background.png"))).resolves.toEqual({
      kind: "url",
      url: "blob:react-obs/background",
    });
    store.dispose();
    expect(revoked).toEqual(["blob:react-obs/background"]);
  });
});
