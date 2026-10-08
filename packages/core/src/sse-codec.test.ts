import { describe, expect, it } from "vitest";

import type { StreamMessage } from "./stream.js";
import { decodeStreamSseEvent, encodeStreamMessageSse, toSseEvent } from "./sse-codec.js";

describe("stream SSE codec", () => {
  const messages: readonly StreamMessage[] = [
    {
      kind: "setup",
      projectId: "codec",
      manifest: { version: 1, assets: [{ name: "logo.png", url: "/assets/logo-abc123.png" }] },
      extensions: [
        { kind: "source:moq", entrypoints: { dom: "moq/dom", obs: "moq/obs" } },
        { kind: "source:custom" },
      ],
    },
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

      expect(framed).toBe(encodeStreamMessageSse(message));
      expect(decodeStreamSseEvent(fields.event, parseSseData(framed))).toEqual(message);
    });
  }

  it("rejects malformed wire IDs with a schema error", () => {
    const data = JSON.stringify({ id: "select", kind: "scene:select", sceneId: "bad::id" });

    expect(() => decodeStreamSseEvent("event", data)).toThrow(/ID must start/u);
  });

  it("rejects a setup without project identity", () => {
    const data = JSON.stringify({ manifest: { version: 1, assets: [] }, extensions: [] });

    expect(() => decodeStreamSseEvent("setup", data)).toThrow(/projectId/u);
  });

  it("rejects protocol-relative and bare relative manifest URLs", () => {
    for (const url of ["//cdn.example/logo.png", "assets/logo.png"]) {
      const data = JSON.stringify({
        projectId: "codec",
        manifest: { version: 1, assets: [{ name: "logo.png", url }] },
        extensions: [],
      });
      expect(() => decodeStreamSseEvent("setup", data)).toThrow(/root-relative path/u);
    }
  });
});

function parseSseData(frame: string): string {
  const line = frame.split("\n").find((candidate) => candidate.startsWith("data: "));
  if (line === undefined) throw new Error("SSE frame has no data field.");
  return line.slice("data: ".length);
}
