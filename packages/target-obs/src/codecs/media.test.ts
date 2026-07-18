import { sourceId, type MediaFileSource } from "@strangecyan/vignette-core";
import { describe, expect, it } from "vitest";

import { mediaCodec } from "./media.js";

describe("mediaCodec", () => {
  it("restarts local media playback whenever the input becomes active", () => {
    const source: MediaFileSource = {
      kind: "source:media-file",
      id: sourceId("stinger"),
      asset: { kind: "asset", name: "stinger.webm" },
      loop: false,
      restartOnActivate: true,
    };

    const result = mediaCodec.compile(source, {
      availableInputKinds: new Set(["ffmpeg_source"]),
      resolvedAsset: "/tmp/vignette/stinger.webm",
    });

    expect(result).toEqual({
      supported: true,
      inputKind: "ffmpeg_source",
      settings: {
        is_local_file: true,
        local_file: "/tmp/vignette/stinger.webm",
        looping: false,
        restart_on_activate: true,
      },
    });
  });

  it("preserves the OBS default when restartOnActivate is omitted", () => {
    const source: MediaFileSource = {
      kind: "source:media-file",
      id: sourceId("clip"),
      asset: { kind: "asset", name: "clip.mp4" },
    };

    const result = mediaCodec.compile(source, {
      availableInputKinds: new Set(["ffmpeg_source"]),
      resolvedAsset: "/tmp/vignette/clip.mp4",
    });

    expect(result).toMatchObject({
      supported: true,
      settings: { restart_on_activate: false },
    });
  });
});
