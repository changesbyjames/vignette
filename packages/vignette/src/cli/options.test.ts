import { describe, expect, it } from "vitest";

import { DEV_HELP, HELP, OBS_HELP, parseCommandLine } from "./options.js";

describe("parseCommandLine", () => {
  it("parses dev with OBS options", () => {
    expect(
      parseCommandLine([
        "dev",
        "show.tsx",
        "--port",
        "5000",
        "--host",
        "0.0.0.0",
        "--obs",
        "--obs-url",
        "ws://10.0.0.2:4455",
        "--password",
        "secret",
      ]),
    ).toEqual({
      command: "dev",
      show: "show.tsx",
      port: 5000,
      host: "0.0.0.0",
      obs: { url: "ws://10.0.0.2:4455", password: "secret", sources: [] },
    });
    expect(parseCommandLine(["dev", "show.tsx"])).toEqual({ command: "dev", show: "show.tsx" });
  });

  it("requires --obs for OBS options in dev", () => {
    expect(() => parseCommandLine(["dev", "show.tsx", "--source", "@vignette/moq/obs"])).toThrow(
      "need --obs",
    );
  });

  it("parses build with a default output directory", () => {
    expect(parseCommandLine(["build", "show.tsx"])).toEqual({
      command: "build",
      show: "show.tsx",
      out: "dist",
    });
    expect(parseCommandLine(["build", "show.tsx", "--out", "site"])).toMatchObject({ out: "site" });
  });

  it("parses bundle and requires --out", () => {
    expect(parseCommandLine(["bundle", "show.tsx", "--out", "public/vignette"])).toEqual({
      command: "bundle",
      show: "show.tsx",
      out: "public/vignette",
    });
    expect(() => parseCommandLine(["bundle", "show.tsx"])).toThrow("--out is required");
  });

  it("parses obs", () => {
    expect(
      parseCommandLine([
        "obs",
        "https://show.example.com/stream",
        "--obs-url",
        "ws://127.0.0.1:4455",
        "--password",
        "secret",
        "--assets-dir",
        "cache",
      ]),
    ).toEqual({
      command: "obs",
      stream: "https://show.example.com/stream",
      obsUrl: "ws://127.0.0.1:4455",
      password: "secret",
      sources: [],
      assetsDir: "cache",
    });
  });

  it("collects repeated --source modules in order", () => {
    expect(
      parseCommandLine([
        "obs",
        "--source",
        "@vignette/moq/obs",
        "http://localhost:4173/stream",
        "--source",
        "./plugins.js",
      ]),
    ).toMatchObject({ sources: ["@vignette/moq/obs", "./plugins.js"] });
    expect(
      parseCommandLine(["dev", "show.tsx", "--obs", "--source", "a", "--source", "b"]),
    ).toMatchObject({ obs: { sources: ["a", "b"] } });
  });

  it("parses preview", () => {
    expect(
      parseCommandLine([
        "preview",
        "http://localhost:4173/stream",
        "--scene",
        "main",
        "--out",
        "main.png",
        "--timeout",
        "5000",
      ]),
    ).toEqual({
      command: "preview",
      stream: "http://localhost:4173/stream",
      scene: "main",
      out: "main.png",
      allScenes: false,
      timeoutMs: 5000,
    });
    expect(parseCommandLine(["preview", "http://localhost:4173/stream", "--all-scenes"])).toEqual({
      command: "preview",
      stream: "http://localhost:4173/stream",
      allScenes: true,
      timeoutMs: 30_000,
    });
  });

  it("rejects conflicting or invalid preview options", () => {
    const stream = "http://localhost:4173/stream";
    expect(() => parseCommandLine(["preview", stream, "--scene", "main", "--all-scenes"])).toThrow(
      "--scene and --all-scenes cannot be combined",
    );
    expect(() => parseCommandLine(["preview", stream, "--timeout", "0"])).toThrow(
      "--timeout must be a positive integer",
    );
  });

  it("requires an absolute HTTP(S) stream URL", () => {
    expect(() => parseCommandLine(["obs", "/stream"])).toThrow(
      "<stream-url> must be an absolute HTTP(S) URL",
    );
    expect(() => parseCommandLine(["obs"])).toThrow("<stream-url> is required");
  });

  it("rejects unknown flags, commands and extra arguments", () => {
    expect(() => parseCommandLine(["obs", "http://h/stream", "--project", "demo"])).toThrow(
      "Unknown option '--project'",
    );
    expect(() => parseCommandLine(["dev", "show.tsx", "--url", "x"])).toThrow(
      "Unknown option '--url'",
    );
    expect(() => parseCommandLine(["serve"])).toThrow("Unknown command 'serve'");
    expect(() => parseCommandLine(["build", "a.tsx", "b.tsx"])).toThrow("Unexpected argument");
    expect(() => parseCommandLine(["dev", "show.tsx", "--port"])).toThrow(
      "--port requires a value",
    );
  });

  it("prints help per command", () => {
    expect(parseCommandLine([])).toEqual({ command: "help", text: HELP });
    expect(parseCommandLine(["--help"])).toEqual({ command: "help", text: HELP });
    expect(parseCommandLine(["obs", "--help"])).toEqual({ command: "help", text: OBS_HELP });
    expect(parseCommandLine(["dev", "--help"])).toEqual({ command: "help", text: DEV_HELP });
  });
});
