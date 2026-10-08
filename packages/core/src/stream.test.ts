import { describe, expect, it, vi } from "vitest";

import {
  consumeStream,
  describeMissingExtensions,
  type StreamMessage,
  type TargetRuntime,
} from "./stream.js";

describe("consumeStream", () => {
  it("applies setup, complete updates, and commands in stream order", async () => {
    const calls: string[] = [];
    const runtime: TargetRuntime = {
      setup: vi.fn(() =>
        Promise.resolve().then(() => {
          calls.push("setup");
        }),
      ),
      update: vi.fn(() => calls.push("update")),
      event: vi.fn(() =>
        Promise.resolve().then(() => {
          calls.push("event");
        }),
      ),
      dispose: vi.fn(() => Promise.resolve()),
    };

    await consumeStream(runtime, messages());

    expect(calls).toEqual(["setup", "update", "event"]);
  });
});

describe("describeMissingExtensions", () => {
  it("names the hinted entrypoint for each kind the target lacks", () => {
    const extensions = [
      { kind: "source:moq", entrypoints: { obs: "@strangecyan/vignette-moq/obs" } },
      { kind: "source:custom" },
      { kind: "source:present" },
    ] as const;

    expect(describeMissingExtensions(extensions, new Set(["source:present"]), "obs")).toBe(
      "Stream requires source kind 'source:moq'; register @strangecyan/vignette-moq/obs. " +
        "Stream requires source kind 'source:custom'; register an OBS codec for it.",
    );
    expect(
      describeMissingExtensions(extensions, new Set(extensions.map(({ kind }) => kind)), "dom"),
    ).toBeUndefined();
  });
});

async function* messages(): AsyncIterable<StreamMessage> {
  await Promise.resolve();
  yield { kind: "setup", projectId: "show", manifest: { version: 1, assets: [] }, extensions: [] };
  yield {
    kind: "update",
    snapshot: {
      revision: 1,
      projectId: "show",
      canvas: { width: 1920, height: 1080 },
      sources: [],
      scenes: [],
      warnings: [],
    },
  };
  yield {
    kind: "event",
    event: { id: "event-1", kind: "scene:select", sceneId: "main" },
  };
}
