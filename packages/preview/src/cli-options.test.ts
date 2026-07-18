import { describe, expect, it } from "vitest";

import { parsePreviewOptions } from "./cli-options.js";

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
