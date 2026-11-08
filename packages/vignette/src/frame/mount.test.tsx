// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { Item, Snapshot, Source } from "../core/snapshot.js";
import type { SetupMessage, StreamMessage } from "../stream/messages.js";
import { encodeStreamMessageSse } from "../stream/sse-codec.js";
import { frame } from "./definition.js";
import { mountFrames } from "./mount.js";

const Score = frame({
  name: "Score",
  params: z.object({ home: z.number() }),
  view: ({ home }) => <span data-testid="score">{home}</span>,
});
const Clock = frame({ name: "Clock", view: () => <span>clock</span> });

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

const setup: SetupMessage = {
  kind: "setup",
  id: "show",
  canvas: { width: 1920, height: 1080 },
  assets: { version: "v1", entries: [] },
  serve: {},
};

function frameSource(id: string, name: string, params: Source["props"]): Source {
  return { id, kind: "frame", props: { frame: name, params }, size: { width: 400, height: 120 } };
}

function update(revision: number, sources: readonly Source[]): StreamMessage {
  const frame = { x: 0, y: 0, width: 400, height: 120 };
  const items = sources.map((source): Item => ({
    id: `layer-${source.id}`,
    sourceId: source.id,
    frame,
    placement: {
      destination: frame,
      sourceCrop: { top: 0, right: 0, bottom: 0, left: 0 },
      alignment: { horizontal: "center", vertical: "center" },
    },
    visible: true,
    opacity: 1,
    rotation: 0,
    kind: "layer",
    props: {},
  }));
  const snapshot: Snapshot = {
    revision,
    id: "show",
    canvas: { width: 1920, height: 1080 },
    sources,
    scenes: [{ id: "main", items }],
  };
  return { kind: "update", snapshot };
}

/** A stream server stand-in: `fetch` answers with SSE the test writes message by message. */
function stubStream(): (message: StreamMessage) => void {
  const encoder = new TextEncoder();
  let push: (message: StreamMessage) => void = () => undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (message) => {
        controller.enqueue(encoder.encode(encodeStreamMessageSse(message)));
      };
    },
  });
  const fetch = vi.fn(() =>
    Promise.resolve(new Response(body, { headers: { "content-type": "text/event-stream" } })),
  );
  vi.stubGlobal("fetch", fetch);
  return (message) => {
    push(message);
  };
}

function mount(search: string, frames = { Score, Clock }): HTMLElement {
  window.history.replaceState(null, "", `/frames.html${search}`);
  const root = document.createElement("div");
  document.body.append(root);
  cleanups.push(mountFrames(frames, { root }));
  return root;
}

const query = "?frame=Score&source=score&stream=http://show.test/stream";

describe("mountFrames", () => {
  it("shows an error when the query string is incomplete", async () => {
    const root = mount("?frame=Score&source=score");
    await vi.waitFor(() => {
      expect(root.querySelector("[role=alert]")?.textContent).toMatch(/\?stream=/u);
    });
  });

  it("shows an error for a frame the bundle does not have", async () => {
    const root = mount("?frame=Nope&source=score&stream=http://show.test/stream");
    await vi.waitFor(() => {
      expect(root.querySelector("[role=alert]")?.textContent).toMatch(/"Nope"/u);
    });
  });

  it("refuses two frames with one name", () => {
    const Twin = frame({ name: "Score", view: () => null });
    expect(() => mountFrames({ Score, Twin }, { root: document.createElement("div") })).toThrow(
      /two frames are named "Score"/u,
    );
  });

  it("renders its source's params and re-renders in place when they change", async () => {
    const send = stubStream();
    const root = mount(query);
    send(setup);
    send(
      update(1, [
        frameSource("other", "Score", { home: 9 }),
        frameSource("score", "Score", { home: 1 }),
      ]),
    );
    await vi.waitFor(() => {
      expect(root.querySelector("[data-testid=score]")?.textContent).toBe("1");
    });
    const node = root.querySelector("[data-testid=score]");

    send(update(2, [frameSource("score", "Score", { home: 2 })]));
    await vi.waitFor(() => {
      expect(root.querySelector("[data-testid=score]")?.textContent).toBe("2");
    });
    expect(root.querySelector("[data-testid=score]")).toBe(node);
  });

  it("renders nothing while its source is absent or another frame", async () => {
    const send = stubStream();
    const root = mount(query);
    send(setup);
    send(update(1, [frameSource("score", "Clock", {})]));
    await vi.waitFor(() => {
      expect(root.textContent).toBe("");
    });
    send(update(2, [frameSource("score", "Score", { home: 3 })]));
    await vi.waitFor(() => {
      expect(root.textContent).toBe("3");
    });
  });

  it("shows the schema's error for invalid params", async () => {
    const send = stubStream();
    const root = mount(query);
    send(setup);
    send(update(1, [frameSource("score", "Score", { home: "two" })]));
    await vi.waitFor(() => {
      expect(root.querySelector("[role=alert]")?.textContent).toMatch(
        /Invalid params for frame "Score"/u,
      );
    });
  });
});
