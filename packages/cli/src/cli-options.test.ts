import { describe, expect, it } from "vitest";

import { parseObsOptions, parsePreviewOptions } from "./cli-options.js";

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
        "https://localhost:5173/api/runtime",
      ]),
    ).toEqual({
      project: "demo",
      obsUrl: "ws://localhost:4455",
      password: "secret",
      url: "https://localhost:5173/api/runtime",
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
        "http://localhost:5173/api/runtime",
      ]),
    ).toEqual({
      project: "demo",
      obsUrl: "ws://localhost:4455",
      url: "http://localhost:5173/api/runtime",
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
      "http://localhost:5173/api/runtime",
    ];
    arguments_.splice(arguments_.indexOf(flag), 2);
    expect(() => parseObsOptions(arguments_)).toThrow(`${flag} is required`);
  });
});
