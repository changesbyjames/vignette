import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseObsOptions, parsePreviewOptions } from "./cli-options.js";
import { loadObsExtensions } from "./obs-extensions.js";

describe("parsePreviewOptions", () => {
  it("parses a named single-scene preview", () => {
    expect(
      parsePreviewOptions([
        "preview",
        "--snapshot",
        "http://localhost:8787/api/state",
        "--scene",
        "programme",
        "--name",
        "test 01",
        "--json",
      ]),
    ).toEqual({
      snapshot: "http://localhost:8787/api/state",
      scene: "programme",
      name: "test 01",
      allScenes: false,
      timeoutMs: 10_000,
      json: true,
    });
  });

  it("rejects incompatible scene selection options", () => {
    expect(() =>
      parsePreviewOptions([
        "preview",
        "--snapshot",
        "snapshot.json",
        "--scene",
        "main",
        "--all-scenes",
      ]),
    ).toThrow("--scene and --all-scenes cannot be combined");
  });

  it("accepts an absolute base URL for root-relative snapshot URLs", () => {
    expect(
      parsePreviewOptions([
        "preview",
        "--snapshot",
        "snapshot.json",
        "--base-url",
        "http://127.0.0.1:4173/",
      ]),
    ).toMatchObject({ baseUrl: "http://127.0.0.1:4173/" });
    expect(() =>
      parsePreviewOptions(["preview", "--snapshot", "snapshot.json", "--base-url", "/stream"]),
    ).toThrow("--base-url must be an absolute HTTP(S) URL");
  });

  it("requires a positive timeout", () => {
    expect(() =>
      parsePreviewOptions(["preview", "--snapshot", "snapshot.json", "--timeout", "0"]),
    ).toThrow("--timeout must be a positive integer");
  });
});

describe("parseObsOptions", () => {
  it("parses OBS and runtime connection options", () => {
    expect(
      parseObsOptions([
        "obs",
        "--project",
        "demo",
        "--obs-url",
        "ws://localhost:4455",
        "--password",
        "secret",
        "--url",
        "https://localhost:5173/api/stream",
      ]),
    ).toEqual({
      project: "demo",
      obsUrl: "ws://localhost:4455",
      password: "secret",
      url: "https://localhost:5173/api/stream",
      extensions: [],
    });
  });

  it("allows passwordless OBS connections", () => {
    expect(
      parseObsOptions([
        "obs",
        "--project",
        "demo",
        "--obs-url",
        "ws://localhost:4455",
        "--url",
        "http://localhost:5173/api/stream",
      ]),
    ).toEqual({
      project: "demo",
      obsUrl: "ws://localhost:4455",
      url: "http://localhost:5173/api/stream",
      extensions: [],
    });
  });

  it("collects repeated extension modules in order", () => {
    expect(
      parseObsOptions([
        "obs",
        "--project",
        "demo",
        "--extension",
        "@strangecyan/vignette-moq/obs",
        "--obs-url",
        "ws://localhost:4455",
        "--url",
        "http://localhost:5173/api/stream",
        "--extension",
        "./codecs.js",
      ]).extensions,
    ).toEqual(["@strangecyan/vignette-moq/obs", "./codecs.js"]);
  });

  it("parses a separate browser-source base URL", () => {
    expect(
      parseObsOptions([
        "obs",
        "--project",
        "demo",
        "--obs-url",
        "ws://localhost:4455",
        "--url",
        "http://vignette-host:4173/stream",
        "--browser-source-base-url",
        "http://127.0.0.1:4173/",
      ]),
    ).toMatchObject({
      url: "http://vignette-host:4173/stream",
      browserSourceBaseUrl: "http://127.0.0.1:4173/",
    });
  });

  it.each(["--project", "--obs-url", "--url"])("requires %s", (flag) => {
    const arguments_ = [
      "obs",
      "--project",
      "demo",
      "--obs-url",
      "ws://localhost:4455",
      "--url",
      "http://localhost:5173/api/stream",
    ];
    arguments_.splice(arguments_.indexOf(flag), 2);
    expect(() => parseObsOptions(arguments_)).toThrow(`${flag} is required`);
  });
});

describe("loadObsExtensions", () => {
  it("registers every exported codec and rejects modules without one", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vignette-extension-"));
    try {
      await writeFile(
        join(directory, "codecs.mjs"),
        [
          "const compile = () => ({ supported: false, reason: 'test' });",
          "export const fooObsCodec = { kind: 'source:foo', inputKinds: ['foo'], compile };",
          "export default [{ kind: 'source:bar', inputKinds: ['bar'], compile }, fooObsCodec];",
          "export const unrelated = { kind: 'scene' };",
        ].join("\n"),
      );
      await writeFile(join(directory, "empty.mjs"), "export const nothing = 1;\n");

      const codecs = await loadObsExtensions(["./codecs.mjs"], directory);
      expect(codecs.map((codec) => codec.kind)).toEqual(["source:foo", "source:bar"]);
      await expect(loadObsExtensions(["./empty.mjs"], directory)).rejects.toThrow(
        "Extension './empty.mjs' exports no OBS source codecs",
      );
      await expect(loadObsExtensions(["missing-vignette-extension"], directory)).rejects.toThrow(
        "Could not load extension 'missing-vignette-extension'",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
