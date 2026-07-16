/**
 * A single-consumer FIFO bridging push-based producers (event listeners, subscribers) to an
 * async iterator. `close()` ends iteration after buffered values drain; `fail()` ends it with
 * an error.
 */
export interface AsyncQueue<T> extends AsyncIterable<T> {
  push(value: T): void;
  close(): void;
  fail(error: Error): void;
}

export function createAsyncQueue<T>(): AsyncQueue<T> {
  const values: T[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  let error: Error | undefined;

  const notify = () => {
    wake?.();
    wake = undefined;
  };

  return {
    push(value) {
      if (closed) return;
      values.push(value);
      notify();
    },
    close() {
      closed = true;
      notify();
    },
    fail(cause) {
      if (closed) return;
      error = cause;
      closed = true;
      notify();
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (values.length > 0) {
          yield values.shift() as T;
          continue;
        }
        if (error !== undefined) throw error;
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}
