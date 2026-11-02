import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { bundle } from "./bundle.js";
import { framesHtml } from "./frames-html.js";
import { scanAssets } from "./scan-assets.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const directories: string[] = [];

afterAll(async () => {
  await Promise.all(directories.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A show project in a temp folder that resolves `vignette` and React like an installed one. */
async function createProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vignette-bundle-"));
  directories.push(dir);
  await mkdir(join(dir, "node_modules"));
  await symlink(packageRoot, join(dir, "node_modules", "vignette"), "dir");
  for (const name of ["react", "react-dom"])
    await symlink(join(packageRoot, "node_modules", name), join(dir, "node_modules", name), "dir");
  await mkdir(join(dir, "assets"));
  await writeFile(join(dir, "assets", "logo.png"), "logo");
  await writeFile(join(dir, "show.tsx"), "export default null;\n");
  await writeFile(
    join(dir, "x.frame.tsx"),
    `import { frame } from "vignette/frame";
export const X = frame({ name: "XFrameName", view: () => <div>x</div> });
`,
  );
  return dir;
}

describe("bundle", () => {
  // Builds `vignette/frame` from `dist`, so `pnpm build` must have run.
  it("writes the assets, their manifest, frames.html and frames.js", async () => {
    const dir = await createProject();
    const out = join(dir, "public", "vignette");

    const result = await bundle(join(dir, "show.tsx"), { out });

    const manifest = await scanAssets(join(dir, "assets"));
    expect(result).toEqual({ manifest, frames: ["x.frame.tsx"] });
    expect(JSON.parse(await readFile(join(out, "assets.json"), "utf8"))).toEqual(manifest);
    expect(await readFile(join(out, "assets", "logo.png"), "utf8")).toBe("logo");
    expect(await readFile(join(out, "frames.html"), "utf8")).toBe(
      framesHtml({ script: "./frames.js" }),
    );
    const script = await readFile(join(out, "frames.js"), "utf8");
    expect(script).toContain("XFrameName");

    await bundle(join(dir, "show.tsx"), { out });
    expect(await readFile(join(out, "frames.js"), "utf8")).toBe(script);
  }, 120_000);
});
