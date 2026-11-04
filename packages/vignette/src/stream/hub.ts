import { createAsyncQueue, type AsyncQueue } from "./async-queue.js";
import type { StreamMessage } from "./messages.js";

/**
 * In-memory fan-out of one stream to any number of targets or wires. Late subscribers replay the
 * latest setup and update so they can converge immediately.
 */
export class StreamHub {
  private readonly subscribers = new Set<AsyncQueue<StreamMessage>>();
  private setup: StreamMessage | undefined;
  private update: StreamMessage | undefined;
  private closed = false;

  /** A new setup clears stale replay state; retain the latest update and forward each message to subscribers. */
  publish(message: StreamMessage): void {
    if (this.closed) throw new Error("Stream hub is closed.");
    if (message.kind === "setup") {
      this.setup = message;
      this.update = undefined;
    }
    if (message.kind === "update") this.update = message;
    for (const subscriber of this.subscribers) subscriber.push(message);
  }

  /**
   * Replay setup before the latest update, and close the subscriber when its abort signal fires. A
   * closed hub replays nothing: a wire still accepting requests while its server shuts down must
   * not hand reconnecting targets a show that is already gone.
   */
  subscribe(signal?: AbortSignal): AsyncIterable<StreamMessage> {
    const queue = createAsyncQueue<StreamMessage>();
    if (this.closed || signal?.aborted === true) {
      queue.close();
      return queue;
    }
    if (this.setup !== undefined) queue.push(this.setup);
    if (this.update !== undefined) queue.push(this.update);
    this.subscribers.add(queue);
    signal?.addEventListener(
      "abort",
      () => {
        this.subscribers.delete(queue);
        queue.close();
      },
      { once: true },
    );
    return queue;
  }

  /** Ends every subscriber's iteration; later publishes throw. */
  close(): void {
    this.closed = true;
    for (const subscriber of this.subscribers) subscriber.close();
    this.subscribers.clear();
  }
}
