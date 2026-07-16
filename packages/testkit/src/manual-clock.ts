/** Deterministic scheduler whose time advances only when requested by a test. */
export class ManualClock {
  #now = 0;
  readonly #tasks: { at: number; run: () => void }[] = [];

  get now(): number {
    return this.#now;
  }

  schedule(delayMs: number, run: () => void): () => void {
    const task = { at: this.#now + delayMs, run };
    this.#tasks.push(task);
    return () => {
      const index = this.#tasks.indexOf(task);
      if (index >= 0) this.#tasks.splice(index, 1);
    };
  }

  setTimeout(run: () => void, delayMs: number): unknown {
    const task = { at: this.#now + delayMs, run };
    this.#tasks.push(task);
    return task;
  }

  clearTimeout(handle: unknown): void {
    const index = this.#tasks.findIndex((task) => task === handle);
    if (index >= 0) this.#tasks.splice(index, 1);
  }

  advanceBy(durationMs: number): void {
    const end = this.#now + durationMs;
    for (;;) {
      this.#tasks.sort((left, right) => left.at - right.at);
      const next = this.#tasks[0];
      if (next === undefined || next.at > end) break;
      this.#tasks.shift();
      this.#now = next.at;
      next.run();
    }
    this.#now = end;
  }
}
