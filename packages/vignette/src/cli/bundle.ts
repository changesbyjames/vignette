import { isAbsolute, join, relative, resolve } from "node:path";

import { bundle } from "../bundle/bundle.js";

/**
 * `vignette bundle <show> --out <dir> [--transport <module>]`: runs `bundle()` and prints what it
 * wrote. Relative transport paths resolve from the working directory, as `--source` paths do.
 */
export async function runBundle(
  show: string,
  out: string,
  transports: readonly string[] = [],
): Promise<void> {
  const modules = transports.map((specifier) =>
    specifier.startsWith(".") && !isAbsolute(specifier) ? resolve(specifier) : specifier,
  );
  const result = await bundle(show, { out, transports: modules });
  const where = (name: string) => relative(process.cwd(), join(out, name)) || ".";
  const assets = result.manifest.entries.length;
  process.stdout.write(
    `${where("assets.json")}  ${String(assets)} asset(s) in ${where("assets")}\n`,
  );
  if (result.script === undefined) {
    process.stdout.write("no *.frame.tsx modules; no frames.html written\n");
    return;
  }
  process.stdout.write(
    `${where("frames.html")}\n${where(result.script)}  ${result.frames.join(", ")}\n${where("frames.json")}  build ${String(result.build)}\n`,
  );
}
