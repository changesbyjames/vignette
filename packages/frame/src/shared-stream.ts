/**
 * One server-sent event stream shared by every same-origin page in a browser.
 *
 * Each frame is its own page, and browsers allow only six HTTP/1.1 connections per host. A
 * connection per frame would starve every other request once a scene holds a handful of frames.
 * Instead, pages elect one leader with a Web Lock. The leader holds the `EventSource` and relays
 * each event over a `BroadcastChannel`. When the leader's page unloads, its lock is released and
 * the next waiting page takes over with a fresh connection.
 */
import { z } from "zod";

const SharedStreamMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hello") }),
  z.object({ kind: z.literal("data"), data: z.string() }),
]);
export type SharedStreamMessage = z.output<typeof SharedStreamMessageSchema>;

const EventDataSchema = z.string();
export type EventData = z.output<typeof EventDataSchema>;

/** Receives the data of each new event, starting with the latest one already seen. */
export type SharedEventListener = (data: string) => void;

const streams = new Map<string, SharedEventStream>();

/**
 * Subscribes to one named event of an SSE stream, sharing a single connection with every other
 * same-origin page that subscribes to the same URL and event. Returns an unsubscribe function.
 */
export function subscribeSharedEvent(
  url: string,
  event: string,
  listener: SharedEventListener,
): () => void {
  const absolute = new URL(url, document.baseURI).href;
  const key = `${event} ${absolute}`;
  let stream = streams.get(key);
  if (stream === undefined) {
    stream = new SharedEventStream(absolute, event, () => streams.delete(key));
    streams.set(key, stream);
  }
  return stream.subscribe(listener);
}

class SharedEventStream {
  private readonly url: string;
  private readonly event: string;
  private readonly onClose: () => void;
  private readonly listeners = new Set<SharedEventListener>();
  private readonly stop = new AbortController();
  private readonly channel: BroadcastChannel | undefined;
  private latest: string | undefined;
  private leader = false;

  constructor(url: string, event: string, onClose: () => void) {
    this.url = url;
    this.event = event;
    this.onClose = onClose;
    const locks = readLocks();
    if (locks === undefined || !("BroadcastChannel" in globalThis)) {
      // Without both primitives there is nothing to share through; connect directly.
      this.channel = undefined;
      this.connect();
      return;
    }
    const name = `vignette:${event}:${url}`;
    this.channel = new BroadcastChannel(name);
    this.channel.addEventListener("message", ({ data }: MessageEvent<SharedStreamMessage>) => {
      this.receive(data);
    });
    locks
      .request(name, { signal: this.stop.signal }, () => this.lead())
      .catch(() => {
        // Closing before this page became leader aborts the request; nothing else can fail it.
      });
    // A late page asks the current leader for the latest event rather than waiting for the next.
    this.channel.postMessage({ kind: "hello" });
  }

  subscribe(listener: SharedEventListener): () => void {
    this.listeners.add(listener);
    if (this.latest !== undefined) listener(this.latest);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.close();
    };
  }

  /** Holds the lock, and with it the only connection, until this stream closes. */
  private lead(): Promise<void> {
    this.leader = true;
    this.connect();
    return new Promise((resolve) => {
      this.stop.signal.addEventListener(
        "abort",
        () => {
          resolve();
        },
        { once: true },
      );
    });
  }

  private connect(): void {
    const source = new EventSource(this.url);
    source.addEventListener(this.event, ({ data }: MessageEvent<string>) => {
      const payload = EventDataSchema.safeParse(data);
      if (!payload.success) return;
      this.deliver(payload.data);
      this.channel?.postMessage({ kind: "data", data: payload.data });
    });
    this.stop.signal.addEventListener(
      "abort",
      () => {
        source.close();
      },
      { once: true },
    );
  }

  /** Followers deliver relayed events; the leader answers a newcomer with the latest one. */
  private receive(raw: SharedStreamMessage): void {
    const message = SharedStreamMessageSchema.safeParse(raw);
    if (!message.success) return;
    if (message.data.kind === "data") {
      this.deliver(message.data.data);
    } else if (this.leader && this.latest !== undefined) {
      this.channel?.postMessage({ kind: "data", data: this.latest });
    }
  }

  /**
   * Events carry whole states, so a repeat of the latest one is dropped. Repeats are expected: a
   * leader answers every newcomer's hello, and the answer reaches pages that already have it.
   */
  private deliver(data: string): void {
    if (data === this.latest) return;
    this.latest = data;
    for (const listener of this.listeners) listener(data);
  }

  private close(): void {
    this.stop.abort();
    this.channel?.close();
    this.onClose();
  }
}

/** The Web Locks manager, when this browser provides one. */
function readLocks(): LockManager | undefined {
  return "locks" in globalThis.navigator ? globalThis.navigator.locks : undefined;
}
