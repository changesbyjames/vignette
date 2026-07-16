import { createAsyncQueue, type AsyncQueue } from "./async-queue.js";
import type { RuntimeMessage } from "./runtime.js";

/**
 * In-memory fan-out of runtime messages to any number of runtimes or transports. Late
 * subscribers replay the latest setup and update so they can converge immediately.
 */
export class RuntimeMessageHub {
  readonly #subscribers = new Set<AsyncQueue<RuntimeMessage>>();
  #setup: RuntimeMessage | undefined;
  #update: RuntimeMessage | undefined;
  #closed = false;

  publish(message: RuntimeMessage): void {
    if (this.#closed) throw new Error("Runtime message hub is closed.");
    if (message.kind === "setup") {
      this.#setup = message;
      this.#update = undefined;
    }
    if (message.kind === "update") this.#update = message;
    for (const subscriber of this.#subscribers) subscriber.push(message);
  }

  subscribe(signal?: AbortSignal): AsyncIterable<RuntimeMessage> {
    const queue = createAsyncQueue<RuntimeMessage>();
    if (this.#setup !== undefined) queue.push(this.#setup);
    if (this.#update !== undefined) queue.push(this.#update);
    if (this.#closed) {
      queue.close();
      return queue;
    }
    this.#subscribers.add(queue);
    signal?.addEventListener(
      "abort",
      () => {
        this.#subscribers.delete(queue);
        queue.close();
      },
      { once: true },
    );
    return queue;
  }

  close(): void {
    this.#closed = true;
    for (const subscriber of this.#subscribers) subscriber.close();
    this.#subscribers.clear();
  }
}
