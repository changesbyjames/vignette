import { describe, expect, it } from "vitest";

import type { RuntimeMessage } from "./runtime.js";
import { decodeRuntimeSseEvent, encodeRuntimeMessageSse, toSseEvent } from "./sse-codec.js";

describe("runtime SSE codec", () => {
  const messages: readonly RuntimeMessage[] = [
    { kind: "setup", manifest: { version: 1, assets: [] } },
    {
      kind: "update",
      snapshot: {
        revision: 3,
        projectId: "codec",
        canvas: { width: 1920, height: 1080 },
        sources: [],
        scenes: [],
        warnings: [],
      },
    },
    { kind: "event", event: { id: "select-main", kind: "scene:select", sceneId: "main" } },
  ];

  for (const message of messages) {
    it(`round-trips ${message.kind} through event fields and SSE framing`, () => {
      const fields = toSseEvent(message);
      const framed = `id: ${fields.id}\nevent: ${fields.event}\ndata: ${fields.data}\n\n`;

      expect(framed).toBe(encodeRuntimeMessageSse(message));
      expect(decodeRuntimeSseEvent(fields.event, parseSseData(framed))).toEqual(message);
    });
  }

  it("rejects malformed wire IDs with a schema error", () => {
    const data = JSON.stringify({ id: "select", kind: "scene:select", sceneId: "bad::id" });

    expect(() => decodeRuntimeSseEvent("event", data)).toThrow(/ID must start/u);
  });
});

function parseSseData(frame: string): string {
  const line = frame.split("\n").find((candidate) => candidate.startsWith("data: "));
  if (line === undefined) throw new Error("SSE frame has no data field.");
  return line.slice("data: ".length);
}
