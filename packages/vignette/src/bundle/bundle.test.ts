import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
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

/** A show project in a temp folder that resolves `@strangecyan/vignette` and React like an installed one. */
async function createProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vignette-bundle-"));
  directories.push(dir);
  await mkdir(join(dir, "node_modules", "@strangecyan"), { recursive: true });
  await symlink(packageRoot, join(dir, "node_modules", "@strangecyan", "vignette"), "dir");
  for (const name of ["react", "react-dom"])
    await symlink(join(packageRoot, "node_modules", name), join(dir, "node_modules", name), "dir");
  await mkdir(join(dir, "assets"));
  await writeFile(join(dir, "assets", "logo.png"), "logo");
  await writeFile(join(dir, "show.tsx"), "export default null;\n");
  await writeFile(
    join(dir, "x.frame.tsx"),
    `import { frame } from "@strangecyan/vignette/frame";
export const X = frame({ name: "XFrameName", view: () => <div>x</div> });
`,
  );
  return dir;
}

describe("bundle", () => {
  // Builds `@strangecyan/vignette/frame` from `dist`, so `pnpm build` must have run.
  it("writes the assets, their manifest, frames.html, the hashed bundle and its build", async () => {
    const dir = await createProject();
    const out = join(dir, "public", "vignette");

    const result = await bundle(join(dir, "show.tsx"), { out });

    const manifest = await scanAssets(join(dir, "assets"));
    const { build, script } = result;
    expect(build).toMatch(/^sha256-[A-Za-z0-9+/]{43}=$/u);
    expect(script).toMatch(/^frames\.[0-9a-f]{16}\.js$/u);
    expect(result).toEqual({ manifest, frames: ["x.frame.tsx"], build, script });
    expect(JSON.parse(await readFile(join(out, "assets.json"), "utf8"))).toEqual(manifest);
    expect(JSON.parse(await readFile(join(out, "frames.json"), "utf8"))).toEqual({ build });
    expect(await readFile(join(out, "assets", "logo.png"), "utf8")).toBe("logo");
    expect(await readFile(join(out, "frames.html"), "utf8")).toBe(
      framesHtml({ script: `./${String(script)}` }),
    );
    const code = await readFile(join(out, String(script)), "utf8");
    expect(code).toContain("XFrameName");
    // The page checks its source's build against the one it was built with.
    expect(code).toContain(String(build));
    expect(await readdir(out)).not.toContain("frames.js");

    // The same sources build the same bundle and hash.
    expect(await bundle(join(dir, "show.tsx"), { out })).toEqual(result);
    expect(await readFile(join(out, String(script)), "utf8")).toBe(code);

    // Changed frame code is a new build, and the old bundle is gone.
    await writeFile(
      join(dir, "x.frame.tsx"),
      `import { frame } from "@strangecyan/vignette/frame";
export const X = frame({ name: "XFrameName", view: () => <div>y</div> });
`,
    );
    const changed = await bundle(join(dir, "show.tsx"), { out });
    expect(changed.build).not.toBe(build);
    expect(changed.script).not.toBe(script);
    expect((await readdir(out)).filter((file) => file.endsWith(".js"))).toEqual([changed.script]);

    // Without frames, there is no page, no bundle and no build.
    await rm(join(dir, "x.frame.tsx"));
    expect(await bundle(join(dir, "show.tsx"), { out })).toEqual({ manifest, frames: [] });
    expect(JSON.parse(await readFile(join(out, "frames.json"), "utf8"))).toEqual({});
    expect((await readdir(out)).filter((file) => file.startsWith("frames."))).toEqual([
      "frames.json",
    ]);
  }, 120_000);
});
