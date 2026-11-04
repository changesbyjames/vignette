import { describe, expect, it, vi } from "vitest";
import type { ObsPluginContext } from "@strangecyan/vignette/obs";

import { moqObs } from "./obs.js";

const size = { width: 1280, height: 720 };
const live = {
  id: "live",
  kind: "moq",
  size,
  props: {
    url: "https://cdn.moq.dev/demo",
    broadcast: "bbb.hang",
    size,
    latencyMs: 250,
    video: true,
    audio: false,
    quality: "hd",
    disableWhenHidden: false,
  },
};

function context(inputKinds: readonly string[]): ObsPluginContext {
  return {
    inputKinds: new Set(inputKinds),
    canvas: { width: 1920, height: 1080 },
    signal: new AbortController().signal,
    assets: { resolve: (name) => Promise.resolve(name) },
    frames: () => "",
    port: () => Promise.resolve(0),
    sourceFile: (sourceId, extension) => Promise.resolve(`${sourceId}${extension}`),
    request: () => Promise.resolve({}),
  };
}

describe("moqObs", () => {
  it("creates a moq_source input with the source's settings", async () => {
    const handle = await moqObs.create(live, context(["moq_source", "browser_source"]));
    expect(handle.input).toEqual({
      kind: "moq_source",
      settings: {
        url: "https://cdn.moq.dev/demo",
        broadcast: "bbb.hang",
        latency_ms: 250,
        video: true,
        audio: false,
        quality: "hd",
        disable_when_hidden: false,
      },
    });
  });

  it("relays through the moq CLI when OBS lacks moq_source, and says when it is missing", async () => {
    vi.stubEnv("VIGNETTE_MOQ_CLI", "/nonexistent/moq");
    try {
      await expect(async () =>
        moqObs.create(live, context(["ffmpeg_source", "browser_source"])),
      ).rejects.toThrow(/'\/nonexistent\/moq' executable was not found/u);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
