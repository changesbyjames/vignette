// @vitest-environment jsdom

import { asset } from "@strangecyan/vignette-core";
import { describe, expect, it, vi } from "vitest";

import { DomAssetStore } from "./asset-store.js";

describe("DomAssetStore", () => {
  it("downloads named assets and exposes browser-owned blob URLs", async () => {
    const revoked: string[] = [];
    const store = new DomAssetStore("http://composer.example/stream", {
      fetch: vi.fn(() => Promise.resolve(new Response("image-bytes"))),
      createObjectURL: () => "blob:vignette/background",
      revokeObjectURL: (url) => revoked.push(url),
    });

    await store.setup({
      version: 1,
      assets: [{ name: "background.png", url: "https://assets.example/background.png" }],
    });

    await expect(store.resolve(asset("background.png"))).resolves.toEqual({
      kind: "url",
      url: "blob:vignette/background",
    });
    store.dispose();
    expect(revoked).toEqual(["blob:vignette/background"]);
  });

  it("downloads root-relative manifest URLs from the configured base origin", async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response("image-bytes")));
    const store = new DomAssetStore("http://composer.example:4173/api/stream", {
      fetch,
      createObjectURL: () => "blob:vignette/logo",
      revokeObjectURL: () => undefined,
    });

    await store.setup({ version: 1, assets: [{ name: "logo.png", url: "/assets/logo-1a2b.png" }] });

    expect(fetch).toHaveBeenCalledWith("http://composer.example:4173/assets/logo-1a2b.png");
    await expect(
      store.setup({ version: 1, assets: [{ name: "logo.png", url: "//cdn.example/logo.png" }] }),
    ).rejects.toThrow(/protocol-relative/u);
  });
});
