import { z } from "zod";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";
import { describe, expect, it } from "vitest";

import { vignette } from "./index.js";

interface InputOptionsContract {
  readonly input?: unknown;
}

interface OutputEntryFileNamesInfo {
  name: string;
}

interface OutputContract {
  entryFileNames(info: OutputEntryFileNamesInfo): string;
}

interface LoadAssetsAssets {
  readonly name: string;
  readonly url: string;
  readonly integrity: string;
}

interface LoadAssetsContract {
  readonly version: string | number;
  readonly assets: readonly LoadAssetsAssets[];
}

interface HookEnvironment {
  readonly name: string;
}
interface HookContext {
  readonly environment?: HookEnvironment;
}
interface HookObject<Args extends unknown[], Result> {
  readonly handler: (...args: Args) => Result;
}

interface IsCodeResult {
  readonly code: string;
}

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../test-fixtures");

describe("vignette", () => {
  it("generates a static registry with route keys matching transformed modules", async () => {
    // Configure the frame fixture, transform its export, and check that registry metadata uses the same route keys.
    const root = resolve(fixtures, "project");
    const plugin = vignette();
    await configure(plugin, root, "build");

    const file = resolve(root, "src/one.frame.tsx");
    const transformed = await runHook(plugin.transform, {}, readFileSync(file, "utf8"), file);
    if (!isCodeResult(transformed)) throw new Error("Frame module was not transformed.");
    const routeKey = /"routeKey":"([^"]+)"/u.exec(transformed.code)?.[1];
    const generated = await runHook(plugin.load, {}, "\0virtual:vignette/frames");

    expect(routeKey).toBeDefined();
    if (routeKey === undefined || !z.string().safeParse(generated).success) {
      throw new Error("Frame virtual module was not generated.");
    }
    expect(generated).toContain(`registry.registerDefinition(frame0["one"]);`);
    expect(generated).toContain(`/assets/vignette/frame/${routeKey}.js`);
    expect(generated).toContain('registry.registerDefinition(frame1["two"]);');
  });

  it("adds deterministic client entries for every discovered frame", async () => {
    const plugin = vignette();
    await configure(plugin, resolve(fixtures, "project"), "build");

    const environmentContext = { environment: { name: "client" } };
    const inputOptions =
      /* SAFETY: The configured client options hook returns the input object inspected by this test. */ (await runHook(
        plugin.options,
        environmentContext,
        {
          input: { app: "/app.html" },
        },
      )) as InputOptionsContract;
    const input = inputOptions.input;
    if (input === null || input === undefined || !(input instanceof Object))
      throw new Error("Client inputs are missing.");
    expect(Object.keys(input)).toEqual(
      expect.arrayContaining([
        "app",
        "vignette-frame-client",
        expect.stringMatching(/^vignette-frame-one-/u),
        expect.stringMatching(/^vignette-frame-two-/u),
      ]),
    );
    const output =
      /* SAFETY: The configured client output hook installs the entryFileNames function exercised by this test. */ (await runHook(
        plugin.outputOptions,
        environmentContext,
        {},
      )) as OutputContract;
    expect(output.entryFileNames({ name: "vignette-frame-client" })).toBe(
      "assets/vignette/frame-client.js",
    );
  });

  it("creates stable content-versioned asset manifests", async () => {
    const first = await loadAssets(resolve(fixtures, "assets-a"));
    const repeated = await loadAssets(resolve(fixtures, "assets-a"));
    const changed = await loadAssets(resolve(fixtures, "assets-b"));

    expect(first).toEqual(repeated);
    expect(first.version).not.toBe(changed.version);
    expect(first.assets[0]).toMatchObject({
      name: "asset.txt",
      url: expect.stringMatching(/^\/assets\/vignette\/asset\/asset-[a-f0-9]{8}\.txt$/u),
      integrity: expect.stringMatching(/^sha256-/u),
    });
  });
});

async function loadAssets(root: string) {
  const plugin = vignette({ assets: "asset.txt" });
  await configure(plugin, root, "build");
  const generated = await runHook(plugin.load, {}, "\0virtual:vignette/assets");
  if (!z.string().safeParse(generated).success)
    throw new Error("Asset virtual module was not generated.");
  return /* SAFETY: The generated module is produced by the asset plugin in this same test process. */ JSON.parse(
    z.string().parse(generated).slice("export const assets = ".length, -1),
  ) as LoadAssetsContract;
}

async function configure(plugin: Plugin, root: string, command: "build" | "serve") {
  await runHook(
    plugin.config,
    {},
    { root },
    { command, mode: "test", isSsrBuild: false, isPreview: false },
  );
}

function runHook<Args extends unknown[], Result>(
  hook: ((...values: Args) => Result) | HookObject<Args, Result> | undefined,
  context: HookContext,
  ...args: Args
): Promise<Awaited<Result>> {
  if (hook === undefined) throw new Error("Expected a plugin hook.");
  const handler = hook instanceof Function ? hook : hook.handler;
  return Promise.resolve(handler.apply(context, args));
}

function isCodeResult(
  value: Parameters<z.ZodType<IsCodeResult>["parse"]>[0],
): value is IsCodeResult {
  return z.object({ code: z.string() }).safeParse(value).success;
}
