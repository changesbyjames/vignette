import { asset, type AssetManifest } from "@strangecyan/vignette-core";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ObsAssetStore } from "./asset-store.js";

describe("ObsAssetStore", () => {
  it("downloads named assets into a private temporary directory", async () => {
    const parent = await mkdtemp(join(tmpdir(), "vignette-test-"));
    const store = new ObsAssetStore({
      temporaryDirectory: parent,
      fetch: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          arrayBuffer: () => Promise.resolve(new TextEncoder().encode("video-bytes").buffer),
        }),
    });

    try {
      await store.setup({
        version: 1,
        assets: [{ name: "loop.mp4", url: "https://assets.example/loop.mp4" }],
      });
      const resolved = await store.resolve(asset("loop.mp4"));
      expect(resolved.kind).toBe("file");
      if (resolved.kind !== "file") return;
      await expect(readFile(resolved.path, "utf8")).resolves.toBe("video-bytes");

      await store.dispose();
      await expect(access(resolved.path)).rejects.toThrow();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("downloads root-relative manifest URLs from the configured base URL", async () => {
    const parent = await mkdtemp(join(tmpdir(), "vignette-test-"));
    const requested: string[] = [];
    const fetch = (url: string) => {
      requested.push(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(new TextEncoder().encode("png").buffer),
      });
    };
    const manifest: AssetManifest = {
      version: 1,
      assets: [{ name: "logo.png", url: "/assets/logo-1a2b.png" }],
    };
    const store = new ObsAssetStore({
      temporaryDirectory: parent,
      baseUrl: "http://vignette-host:4173/stream",
      fetch,
    });
    const unconfigured = new ObsAssetStore({ temporaryDirectory: parent, fetch });

    try {
      await store.setup(manifest);
      expect(requested).toEqual(["http://vignette-host:4173/assets/logo-1a2b.png"]);
      await expect(unconfigured.setup(manifest)).rejects.toThrow(/no baseUrl/u);
    } finally {
      await store.dispose();
      await rm(parent, { recursive: true, force: true });
    }
  });
});
