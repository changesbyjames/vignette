import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadPlugins } from "./load-plugins.js";

describe("loadPlugins", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "vignette-plugins-"));
    await writeFile(
      join(directory, "plugins.mjs"),
      [
        "const create = () => ({ input: { kind: 'color_source_v3', settings: {} } });",
        "export const fooObs = { kind: 'foo', create };",
        "export default [{ kind: 'bar', create }, fooObs];",
        "export const unrelated = { kind: 'baz' };",
        "export const count = 3;",
      ].join("\n"),
    );
    await writeFile(join(directory, "empty.mjs"), "export const nothing = { kind: 'x' };\n");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("collects every exported plugin, directly or in an array, once", async () => {
    const plugins = await loadPlugins(["./plugins.mjs"], directory);
    expect(plugins.map((plugin) => plugin.kind).toSorted()).toEqual(["bar", "foo"]);
  });

  it("accepts absolute paths and file URLs", async () => {
    const path = join(directory, "plugins.mjs");
    expect(await loadPlugins([path], "/")).toHaveLength(2);
    expect(await loadPlugins([pathToFileURL(path).href], "/")).toHaveLength(2);
  });

  it("rejects a module without plugins and a module that cannot load", async () => {
    await expect(loadPlugins(["./empty.mjs"], directory)).rejects.toThrow(
      "Source module './empty.mjs' exports no OBS source plugins",
    );
    await expect(loadPlugins(["missing-vignette-plugin"], directory)).rejects.toThrow(
      "Could not load source module 'missing-vignette-plugin'",
    );
  });
});
