import { describe, expect, it } from "vitest";

import type { StreamMessage } from "./messages.js";
import { decodeStreamSseEvent, encodeStreamMessageSse, toSseEvent } from "./sse-codec.js";

describe("stream SSE codec", () => {
  const messages: readonly StreamMessage[] = [
    {
      kind: "setup",
      id: "codec",
      canvas: { width: 1920, height: 1080 },
      kinds: ["color", "moq"],
      assets: { version: "sha256-v1", entries: [{ name: "logo.png", hash: "sha256-abc" }] },
      serve: {
        stream: "https://show.example/stream",
        assets: "https://show.example/vignette/assets/",
      },
    },
    {
      kind: "update",
      snapshot: {
        revision: 3,
        id: "codec",
        canvas: { width: 1920, height: 1080 },
        activeScene: "main",
        sources: [
          {
            id: "background",
            kind: "color",
            props: { color: "#000000" },
            size: { width: 1920, height: 1080 },
          },
        ],
        scenes: [
          {
            id: "main",
            items: [
              {
                id: "background",
                sourceId: "background",
                frame: { x: 0, y: 0, width: 1920, height: 1080 },
                placement: {
                  destination: { x: 0, y: 0, width: 1920, height: 1080 },
                  sourceCrop: { top: 0, right: 0, bottom: 0, left: 0 },
                  alignment: { horizontal: "center", vertical: "center" },
                },
                visible: true,
                opacity: 1,
                rotation: 0,
              },
            ],
          },
        ],
      },
    },
    { kind: "event", event: { kind: "media:restart", sourceId: "intro" } },
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
    const data = JSON.stringify({
      revision: 1,
      id: "bad::id",
      canvas: { width: 1920, height: 1080 },
      sources: [],
      scenes: [],
    });

    expect(() => decodeStreamSseEvent("update", data)).toThrow(/ID must start/u);
  });

  it("rejects a setup without show identity", () => {
    const data = JSON.stringify({
      canvas: { width: 1920, height: 1080 },
      kinds: [],
      assets: { version: "v", entries: [] },
      serve: {},
    });

    expect(() => decodeStreamSseEvent("setup", data)).toThrow(/id/u);
  });

  it("rejects relative serve locations", () => {
    const data = JSON.stringify({
      id: "codec",
      canvas: { width: 1920, height: 1080 },
      kinds: [],
      assets: { version: "v", entries: [] },
      serve: { assets: "/vignette/assets/" },
    });

    expect(() => decodeStreamSseEvent("setup", data)).toThrow(/URL/iu);
  });
});

function parseSseData(frame: string): string {
  const line = frame.split("\n").find((candidate) => candidate.startsWith("data: "));
  if (line === undefined) throw new Error("SSE frame has no data field.");
  return line.slice("data: ".length);
}
