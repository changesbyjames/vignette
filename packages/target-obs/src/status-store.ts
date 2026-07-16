import type { TargetStatus } from "@cbj/react-obs-core";

export class ObsStatusStore {
  readonly #listeners = new Set<() => void>();
  #status: TargetStatus;

  constructor(targetId: string) {
    this.#status = { targetId, phase: "disconnected" };
  }

  getSnapshot(): TargetStatus {
    return this.#status;
  }

  set(status: TargetStatus): void {
    this.#status = status;
    for (const listener of this.#listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  clear(): void {
    this.#listeners.clear();
  }
}
