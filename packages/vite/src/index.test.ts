import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";
import { describe, expect, it } from "vitest";

import { vignette } from "./index.js";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../test-fixtures");

describe("vignette", () => {
  it("generates a static registry with route keys matching transformed modules", async () => {
    const root = resolve(fixtures, "project");
    const plugin = vignette();
    await configure(plugin, root, "build");

    const file = resolve(root, "src/one.frame.tsx");
    const transformed = await runHook(plugin.transform, {}, readFileSync(file, "utf8"), file);
    if (!isCodeResult(transformed)) throw new Error("Frame module was not transformed.");
    const routeKey = /"routeKey":"([^"]+)"/u.exec(transformed.code)?.[1];
    const generated = await runHook(plugin.load, {}, "\0virtual:vignette/frames");

    expect(routeKey).toBeDefined();
    if (routeKey === undefined || typeof generated !== "string") {
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
    const inputOptions = (await runHook(plugin.options, environmentContext, {
      input: { app: "/app.html" },
    })) as { readonly input?: unknown };
    const input = inputOptions.input;
    if (typeof input !== "object" || input === null) throw new Error("Client inputs are missing.");
    expect(Object.keys(input)).toEqual(
      expect.arrayContaining([
        "app",
        "vignette-frame-client",
        expect.stringMatching(/^vignette-frame-one-/u),
        expect.stringMatching(/^vignette-frame-two-/u),
      ]),
    );
    const output = (await runHook(plugin.outputOptions, environmentContext, {})) as {
      entryFileNames(info: { name: string }): string;
    };
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
  if (typeof generated !== "string") throw new Error("Asset virtual module was not generated.");
  return JSON.parse(generated.slice("export const assets = ".length, -1)) as {
    readonly version: string | number;
    readonly assets: readonly {
      readonly name: string;
      readonly url: string;
      readonly integrity: string;
    }[];
  };
}

async function configure(plugin: Plugin, root: string, command: "build" | "serve") {
  await runHook(
    plugin.config,
    {},
    { root },
    { command, mode: "test", isSsrBuild: false, isPreview: false },
  );
}

function runHook(hook: unknown, context: object, ...args: unknown[]): Promise<unknown> {
  if (typeof hook === "function") {
    return Promise.resolve((hook as (...values: unknown[]) => unknown).call(context, ...args));
  }
  if (typeof hook === "object" && hook !== null && "handler" in hook) {
    const result = (hook as { handler: (...values: unknown[]) => unknown }).handler.call(
      context,
      ...args,
    );
    return Promise.resolve(result);
  }
  throw new Error("Expected a plugin hook.");
}

function isCodeResult(value: unknown): value is { readonly code: string } {
  return (
    typeof value === "object" && value !== null && "code" in value && typeof value.code === "string"
  );
}
