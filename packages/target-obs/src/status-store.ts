import type { TargetStatus } from "@strangecyan/vignette-core";

export class ObsStatusStore {
  private readonly listeners = new Set<() => void>();
  private status: TargetStatus = { phase: "disconnected", revision: 0 };

  getSnapshot(): TargetStatus {
    return this.status;
  }

  set(status: TargetStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.listeners.clear();
  }
}
