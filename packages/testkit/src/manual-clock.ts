interface ManualClockTasks {
  at: number;
  run: () => void;
}
/** Deterministic scheduler whose time advances only when requested by a test. */
export class ManualClock {
  private currentTime = 0;
  private readonly tasks: ManualClockTasks[] = [];

  get now(): number {
    return this.currentTime;
  }

  schedule(delayMs: number, run: () => void): () => void {
    const task = { at: this.currentTime + delayMs, run };
    this.tasks.push(task);
    return () => {
      const index = this.tasks.indexOf(task);
      if (index >= 0) this.tasks.splice(index, 1);
    };
  }

  setTimeout(run: () => void, delayMs: number): () => void {
    return this.schedule(delayMs, run);
  }

  clearTimeout(handle: () => void): void {
    handle();
  }

  advanceBy(durationMs: number): void {
    const end = this.currentTime + durationMs;
    for (;;) {
      this.tasks.sort((left, right) => left.at - right.at);
      const next = this.tasks[0];
      if (next === undefined || next.at > end) break;
      this.tasks.shift();
      this.currentTime = next.at;
      next.run();
    }
    this.currentTime = end;
  }
}
