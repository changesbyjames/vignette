import { sourceId } from "@strangecyan/vignette-core";
import { describe, expect, it } from "vitest";

import type { MoqSource } from "./index.js";
import { moqObsCodec } from "./obs.js";

describe("moqObsCodec", () => {
  it("compiles the neutral source to moq_source settings", () => {
    const source: MoqSource = {
      kind: "source:moq",
      id: sourceId("live"),
      url: "https://cdn.moq.dev/demo",
      broadcast: "bbb.hang",
      size: { width: 1280, height: 720 },
      latencyMs: 250,
      audio: false,
      quality: "hd",
      disableWhenHidden: false,
    };

    expect(moqObsCodec.compile(source, { availableInputKinds: new Set(["moq_source"]) })).toEqual({
      supported: true,
      inputKind: "moq_source",
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

  it("reports unsupported targets and applies defaults", () => {
    const source: MoqSource = {
      kind: "source:moq",
      id: sourceId("live"),
      url: "https://cdn.moq.dev/demo",
      broadcast: "bbb.hang",
      size: { width: 1280, height: 720 },
    };

    expect(moqObsCodec.compile(source, { availableInputKinds: new Set() })).toEqual({
      supported: false,
      reason: "OBS MoQ input kind 'moq_source' is unavailable.",
    });
    expect(
      moqObsCodec.compile(source, { availableInputKinds: new Set(["moq_source"]) }),
    ).toMatchObject({
      supported: true,
      settings: { latency_ms: 100, video: true, audio: true, disable_when_hidden: true },
    });
  });
});
