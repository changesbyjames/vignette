import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scanAssets } from "./scan-assets.js";

function sha256(data: string): string {
  return `sha256-${createHash("sha256").update(data).digest("base64")}`;
}

describe("scanAssets", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "vignette-scan-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("names every file by its POSIX path and hashes its bytes", async () => {
    await mkdir(join(dir, "logos", "dark"), { recursive: true });
    await writeFile(join(dir, "logo.png"), "logo");
    await writeFile(join(dir, "logos", "dark", "mark.svg"), "<svg/>");

    const manifest = await scanAssets(dir);

    expect(manifest.entries).toEqual([
      { name: "logo.png", hash: sha256("logo") },
      { name: "logos/dark/mark.svg", hash: sha256("<svg/>") },
    ]);
    expect(manifest.version).toBe(
      sha256(`logo.png:${sha256("logo")}\nlogos/dark/mark.svg:${sha256("<svg/>")}`),
    );
  });

  it("produces the same version for the same files and a new one when bytes change", async () => {
    await writeFile(join(dir, "b.png"), "b");
    await writeFile(join(dir, "a.png"), "a");
    const first = await scanAssets(dir);
    expect(await scanAssets(dir)).toEqual(first);

    await writeFile(join(dir, "a.png"), "changed");
    expect((await scanAssets(dir)).version).not.toBe(first.version);
  });
});
