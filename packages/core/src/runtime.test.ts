import { describe, expect, it, vi } from "vitest";

import { projectId, sceneId } from "./ids.js";
import { consumeRuntimeMessages, type RuntimeMessage, type SnapshotRuntime } from "./runtime.js";

describe("consumeRuntimeMessages", () => {
  it("applies setup, complete updates, and commands in stream order", async () => {
    const calls: string[] = [];
    const runtime: SnapshotRuntime = {
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

    await consumeRuntimeMessages(runtime, messages());

    expect(calls).toEqual(["setup", "update", "event"]);
  });
});

async function* messages(): AsyncIterable<RuntimeMessage> {
  await Promise.resolve();
  yield { kind: "setup", manifest: { version: 1, assets: [] } };
  yield {
    kind: "update",
    snapshot: {
      revision: 1,
      projectId: projectId("show"),
      canvas: { width: 1920, height: 1080 },
      sources: [],
      scenes: [],
      warnings: [],
    },
  };
  yield {
    kind: "event",
    event: { id: "event-1", kind: "scene:select", sceneId: sceneId("main") },
  };
}
