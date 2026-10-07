import { z } from "zod";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createServer, resolveConfig, type InlineConfig, type Plugin } from "vite";
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

  it("contributes Yoga, React, and dev SSR defaults without dropping user configuration", async () => {
    const userConfig = {
      configFile: false,
      logLevel: "silent",
      root: resolve(fixtures, "project"),
      plugins: [vignette()],
      optimizeDeps: { exclude: ["user-dep"] },
      resolve: { dedupe: ["zod"] },
      ssr: { external: ["hono"] },
    } satisfies InlineConfig;
    const serve = await resolveConfig(userConfig, "serve");
    const build = await resolveConfig(userConfig, "build");

    expect(serve.optimizeDeps.exclude).toEqual(["user-dep", "yoga-layout"]);
    expect(serve.resolve.dedupe).toEqual(["zod", "react", "react-dom"]);
    expect(serve.environments.ssr?.resolve.external).toEqual([
      "hono",
      "@strangecyan/vignette",
      "@strangecyan/vignette-frame",
    ]);
    expect(build.resolve.dedupe).toEqual(["zod", "react", "react-dom"]);
    expect(build.environments.ssr?.resolve.external).toEqual(["hono"]);
  });

  it("serves the dev composition and replaces the root when its module changes identity", async () => {
    // Serve a dependency-free composition, then rewrite its project ID: the open stream must close
    // and a reconnecting client must receive the replacement root's setup.
    const root = realpathSync(mkdtempSync(resolve(tmpdir(), "vignette-dev-composer-")));
    const writeComposition = (id: string) => {
      writeFileSync(
        resolve(root, "show.js"),
        `export const composition = { id: ${JSON.stringify(id)}, canvas: { width: 64, height: 36 }, component: () => null };\n`,
      );
    };
    writeComposition("first");
    const server = await createServer({
      configFile: false,
      logLevel: "silent",
      root,
      server: { host: "127.0.0.1", port: 0 },
      plugins: [vignette({ composition: "./show.js", streamPath: "/live" })],
    });
    try {
      await server.listen();
      const { port } = z.object({ port: z.number() }).parse(server.httpServer?.address());
      const url = `http://127.0.0.1:${String(port)}/live`;

      const first = await fetch(url);
      expect(first.headers.get("content-type")).toMatch(/^text\/event-stream/u);
      const reader = first.body?.getReader();
      if (reader === undefined) throw new Error("The composer stream has no body.");
      expect(await readSetupProjectId(reader)).toBe("first");

      writeComposition("second");
      // Changing the project ID retires the root, which closes the open stream.
      await expect(drain(reader)).resolves.toBeUndefined();
      await expect.poll(async () => readSetupProjectId(await openStream(url))).toBe("second");
      expect((await fetch(url.replace("/live", "/stream"))).status).not.toBe(200);
    } finally {
      await server.close();
      rmSync(root, { recursive: true, force: true });
    }
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

type StreamReader = ReadableStreamDefaultReader<Uint8Array>;

async function openStream(url: string): Promise<StreamReader> {
  const response = await fetch(url);
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("The composer stream has no body.");
  return reader;
}

/** Reads until the setup event, returns its project ID, and releases the connection. */
async function readSetupProjectId(reader: StreamReader): Promise<string | undefined> {
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return undefined;
    text += decoder.decode(chunk.value, { stream: true });
    const projectId = /event: setup\ndata: \{"projectId":"([^"]+)"/u.exec(text)?.[1];
    if (projectId !== undefined) {
      await reader.cancel();
      return projectId;
    }
  }
}

async function drain(reader: StreamReader): Promise<undefined> {
  for (;;) {
    if ((await reader.read()).done) return undefined;
  }
}

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
