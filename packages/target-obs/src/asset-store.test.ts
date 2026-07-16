import { asset } from "@cbj/react-obs-core";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ObsAssetStore } from "./asset-store.js";

describe("ObsAssetStore", () => {
  it("downloads named assets into a private temporary directory", async () => {
    const parent = await mkdtemp(join(tmpdir(), "react-obs-test-"));
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
});
