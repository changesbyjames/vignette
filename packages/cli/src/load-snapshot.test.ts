import { encodeRuntimeMessageSse, type CompiledSnapshot } from "@strangecyan/vignette-core";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadSnapshot } from "./load-snapshot.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("loadSnapshot", () => {
  it("loads a compiled snapshot from a local JSON file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vignette-preview-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "snapshot.json");
    await writeFile(path, JSON.stringify(snapshotFixture));

    const loaded = await loadSnapshot(path, 1_000);

    expect(loaded.snapshot.projectId).toBe("preview-test");
    expect(loaded.localAssetRoot).toBe(directory);
  });

  it("requires a base URL for root-relative URLs in a local snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vignette-preview-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "snapshot.json");
    const frameUrl = "/__vignette/frame/label?props=%7B%7D";
    await writeFile(
      path,
      JSON.stringify({
        ...snapshotFixture,
        sources: [
          {
            id: "label",
            definition: {
              id: "label",
              kind: "source:browser",
              url: frameUrl,
              viewport: { width: 320, height: 180 },
            },
          },
        ],
      }),
    );

    await expect(loadSnapshot(path, 1_000)).rejects.toThrow(/pass --base-url/u);
    const loaded = await loadSnapshot(path, 1_000, "http://127.0.0.1:4173/");
    expect(loaded.baseUrl).toBe("http://127.0.0.1:4173/");
  });

  it("takes setup and the first update from a runtime SSE stream", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/event-stream");
      response.write(
        encodeRuntimeMessageSse({
          kind: "setup",
          projectId: "preview-test",
          manifest: {
            version: 1,
            assets: [{ name: "logo.png", url: "/assets/logo.png" }],
          },
          extensions: [],
        }),
      );
      response.write(encodeRuntimeMessageSse({ kind: "update", snapshot: snapshotFixture }));
    });
    await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
    const address = server.address();
    if (address === null || !(address instanceof Object))
      throw new Error("Test server did not bind.");

    try {
      const loaded = await loadSnapshot(`http://127.0.0.1:${String(address.port)}/runtime`, 1_000);
      expect(loaded.snapshot.revision).toBe(7);
      expect(loaded.assetUrls["logo.png"]).toBe(
        `http://127.0.0.1:${String(address.port)}/assets/logo.png`,
      );
      expect(loaded.baseUrl).toBe(`http://127.0.0.1:${String(address.port)}/runtime`);
    } finally {
      await new Promise<void>((resolvePromise, reject) => {
        server.close((error) => {
          if (error === undefined) resolvePromise();
          else reject(error);
        });
      });
    }
  });
});

const snapshotFixture: CompiledSnapshot = {
  revision: 7,
  projectId: "preview-test",
  canvas: { width: 320, height: 180 },
  sources: [],
  scenes: [
    {
      id: "main",
      items: [],
    },
  ],
  warnings: [],
};
