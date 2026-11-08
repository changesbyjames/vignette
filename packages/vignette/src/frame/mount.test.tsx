// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { Item, Snapshot, Source } from "../core/snapshot.js";
import type { SetupMessage, StreamMessage } from "../stream/messages.js";
import { createAsyncQueue } from "../stream/async-queue.js";
import { encodeStreamMessageSse } from "../stream/sse-codec.js";
import type { StreamTransport } from "../stream/transport.js";
import { encodeStreamMessage } from "../stream/websocket.js";
import { frame } from "./definition.js";
import { mountFrames, streamTransports, type MountFramesOptions } from "./mount.js";

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

/** The URLs sockets were opened with, and a way to send every open socket a message. */
interface WebSocketStub {
  readonly urls: readonly string[];
  readonly send: (message: StreamMessage) => void;
}

/** A WebSocket server stand-in: the page's socket opens and receives what the test sends. */
function stubWebSocket(): WebSocketStub {
  const urls: string[] = [];
  const sockets: FakeSocket[] = [];
  class FakeSocket extends EventTarget {
    binaryType = "blob";
    constructor(url: string | URL) {
      super();
      urls.push(String(url));
      sockets.push(this);
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }
    close(): void {
      this.dispatchEvent(Object.assign(new Event("close"), { code: 1000, reason: "" }));
    }
  }
  vi.stubGlobal("WebSocket", FakeSocket);
  return {
    urls,
    send: (message) => {
      const data = encodeStreamMessage(message);
      for (const socket of sockets) socket.dispatchEvent(new MessageEvent("message", { data }));
    },
  };
}

function mount(
  search: string,
  frames = { Score, Clock },
  options: MountFramesOptions = {},
): HTMLElement {
  window.history.replaceState(null, "", `/frames.html${search}`);
  const root = document.createElement("div");
  document.body.append(root);
  cleanups.push(mountFrames(frames, { root, ...options }));
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

  it("reads a ws: stream URL over WebSocket", async () => {
    const socket = stubWebSocket();
    const root = mount("?frame=Score&source=score&stream=ws://show.test/stream?source=score");
    await vi.waitFor(() => {
      expect(socket.urls).toEqual(["ws://show.test/stream?source=score"]);
    });
    socket.send(setup);
    socket.send(update(1, [frameSource("score", "Score", { home: 4 })]));
    await vi.waitFor(() => {
      expect(root.querySelector("[data-testid=score]")?.textContent).toBe("4");
    });
  });

  it("reads a custom scheme with the transport given for it", async () => {
    const messages = createAsyncQueue<StreamMessage>();
    const connect = vi.fn(() => messages);
    const transport: StreamTransport = { protocols: ["nats:"], connect };
    const root = mount(
      "?frame=Score&source=score&stream=nats://show.test/show?source=score",
      { Score, Clock },
      { transports: [transport] },
    );
    messages.push(setup);
    messages.push(update(1, [frameSource("score", "Score", { home: 5 })]));
    await vi.waitFor(() => {
      expect(root.querySelector("[data-testid=score]")?.textContent).toBe("5");
    });
    expect(connect).toHaveBeenCalledWith(
      "nats://show.test/show?source=score",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("renders nothing for a scheme no transport handles", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const root = mount("?frame=Score&source=score&stream=nats://show.test/show");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(root.textContent).toBe("");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("streamTransports", () => {
  const transport: StreamTransport = { protocols: ["nats:"], connect: () => createAsyncQueue() };
  const other: StreamTransport = { protocols: ["moq:"], connect: () => createAsyncQueue() };

  it("collects transports exported directly or in arrays, ignoring other exports", () => {
    expect(
      streamTransports({ default: transport, helper: () => undefined }, { all: [other, 1] }),
    ).toEqual([transport, other]);
  });

  it("refuses a module that exports no transports", () => {
    expect(() => streamTransports({ transport }, { helper: () => undefined })).toThrow(
      /transport module 2 exports no stream transports/u,
    );
  });
});
