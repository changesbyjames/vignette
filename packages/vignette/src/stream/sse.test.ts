import { afterEach, describe, expect, it, vi } from "vitest";

import type { StreamMessage } from "./messages.js";
import { encodeStreamMessageSse } from "./sse-codec.js";
import { fromSse, type SseConnection } from "./sse.js";

const setupMessage: StreamMessage = {
  kind: "setup",
  id: "show",
  canvas: { width: 1920, height: 1080 },
  assets: { version: "v1", entries: [] },
  serve: { stream: "https://show.example/stream" },
};
const updateMessage: StreamMessage = {
  kind: "update",
  snapshot: {
    revision: 1,
    id: "show",
    canvas: { width: 1920, height: 1080 },
    sources: [],
    scenes: [{ id: "main", items: [] }],
  },
};
const messages: readonly StreamMessage[] = [
  setupMessage,
  updateMessage,
  { kind: "event", event: { kind: "media:restart", sourceId: "intro" } },
];

/** A body that delivers `text` in chunks of `size` bytes, so records split anywhere. */
function chunked(text: string, size: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}

async function collect(stream: AsyncIterable<StreamMessage>): Promise<StreamMessage[]> {
  const received: StreamMessage[] = [];
  for await (const message of stream) received.push(message);
  return received;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fromSse", () => {
  it("decodes records split mid-record and mid-CRLF, with comments and multi-line data", async () => {
    const wire = messages
      .map((message) => encodeStreamMessageSse(message).replaceAll("\n", "\r\n"))
      .join(": keep-alive\r\n\r\n");
    for (const size of [1, 3, 7, 64]) {
      expect(await collect(fromSse(chunked(wire, size)))).toEqual(messages);
    }

    const multiLine = 'event: event\ndata: {"kind":\ndata: "flash"}\n\n';
    expect(await collect(fromSse(chunked(multiLine, 5)))).toEqual([
      { kind: "event", event: { kind: "flash" } },
    ]);
  });

  it("ignores unknown events and discards a record cut off by the end of the body", async () => {
    const wire = `event: message\ndata: {}\n\n${encodeStreamMessageSse(setupMessage)}event: update\ndata: {`;
    expect(await collect(fromSse(chunked(wire, 16)))).toEqual([messages[0]]);
  });

  it("reads a Response once and ends", async () => {
    const response = new Response(messages.map(encodeStreamMessageSse).join(""));
    const stream = fromSse(response);
    expect(await collect(stream)).toEqual(messages);
    await expect(collect(stream)).rejects.toThrow();
  });

  it("throws for a failed Response instead of retrying", async () => {
    await expect(collect(fromSse(new Response("nope", { status: 503 })))).rejects.toThrow(
      /HTTP 503/u,
    );
  });

  it("reconnects to a URL with backoff until the signal aborts", async () => {
    const abort = new AbortController();
    const requests: string[] = [];
    const responses = [
      () => Promise.reject(new TypeError("connection refused")),
      () => Promise.resolve(new Response("", { status: 502 })),
      () => Promise.resolve(new Response(encodeStreamMessageSse(setupMessage))),
      () => Promise.resolve(new Response(encodeStreamMessageSse(updateMessage))),
    ];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      requests.push(String(input));
      const next = responses.shift();
      if (next === undefined) {
        abort.abort();
        throw new DOMException("aborted", "AbortError");
      }
      return next();
    });

    const received = await collect(
      fromSse("https://show.example/stream", {
        signal: abort.signal,
        retry: { initialDelayMs: 1, maximumDelayMs: 4 },
      }),
    );

    expect(received).toEqual([messages[0], messages[1]]);
    expect(requests).toHaveLength(5);
    expect(new Set(requests)).toEqual(new Set(["https://show.example/stream"]));
  });

  it("reports connecting, open, retry-wait and closed with the attempt and last error", async () => {
    const abort = new AbortController();
    const responses = [
      () => Promise.reject(new TypeError("connection refused")),
      () => Promise.resolve(new Response(encodeStreamMessageSse(setupMessage))),
    ];
    vi.stubGlobal("fetch", async () => {
      const next = responses.shift();
      if (next === undefined) {
        abort.abort();
        throw new DOMException("aborted", "AbortError");
      }
      return next();
    });
    const states: SseConnection[] = [];

    await collect(
      fromSse("https://show.example/stream", {
        signal: abort.signal,
        retry: { initialDelayMs: 50 },
        onConnection: (state) => states.push(state),
      }),
    );

    expect(states.map(({ phase, attempt }) => `${phase}:${String(attempt)}`)).toEqual([
      "connecting:0",
      "retry-wait:1",
      "connecting:1",
      "open:1",
      // The message clears the error. The body ends at once, so the backoff keeps growing.
      "open:1",
      "retry-wait:2",
      "connecting:2",
      "closed:2",
    ]);
    expect(states[1]?.error?.message).toBe("connection refused");
    expect(states[4]?.error).toBeUndefined();
  });

  it("resets the backoff after a connection stays open longer than its next delay", async () => {
    const abort = new AbortController();
    const held = () =>
      new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode(encodeStreamMessageSse(setupMessage)));
          await new Promise((resolve) => setTimeout(resolve, 30));
          controller.close();
        },
      });
    const responses = [
      () => Promise.reject(new TypeError("connection refused")),
      () => Promise.resolve(new Response(held())),
    ];
    vi.stubGlobal("fetch", async () => {
      const next = responses.shift();
      if (next === undefined) {
        abort.abort();
        throw new DOMException("aborted", "AbortError");
      }
      return next();
    });
    const states: SseConnection[] = [];

    await collect(
      fromSse("https://show.example/stream", {
        signal: abort.signal,
        retry: { initialDelayMs: 1, maximumDelayMs: 4 },
        onConnection: (state) => states.push(state),
      }),
    );

    const waits = states.filter(({ phase }) => phase === "retry-wait");
    expect(waits.map(({ attempt }) => attempt)).toEqual([1, 1]);
  });

  it("does not retry a stream that sends an invalid message", async () => {
    let requests = 0;
    vi.stubGlobal("fetch", () => {
      requests += 1;
      return Promise.resolve(new Response('event: update\ndata: {"revision":"one"}\n\n'));
    });
    const states: SseConnection[] = [];
    await expect(
      collect(
        fromSse("https://show.example/stream", {
          retry: { initialDelayMs: 1 },
          onConnection: (state) => states.push(state),
        }),
      ),
    ).rejects.toThrow();
    expect(requests).toBe(1);
    expect(states.at(-1)?.phase).toBe("closed");
    expect(states.at(-1)?.error).toBeDefined();
  });
});
