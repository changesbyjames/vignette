import { join, relative } from "node:path";

import { bundle } from "../bundle/bundle.js";

/** `vignette bundle <show> --out <dir>`: runs `bundle()` and prints what it wrote. */
export async function runBundle(show: string, out: string): Promise<void> {
  const result = await bundle(show, { out });
  const where = (name: string) => relative(process.cwd(), join(out, name)) || ".";
  const assets = result.manifest.entries.length;
  process.stdout.write(
    `${where("assets.json")}  ${String(assets)} asset(s) in ${where("assets")}\n`,
  );
  if (result.frames.length === 0) {
    process.stdout.write("no *.frame.tsx modules; no frames.html written\n");
    return;
  }
  process.stdout.write(
    `${where("frames.html")}\n${where("frames.js")}  ${result.frames.join(", ")}\n`,
  );
}
