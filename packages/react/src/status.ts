import type { Diagnostic } from "@cbj/react-obs-core";

export type BroadcastRootPhase = "idle" | "compiling" | "ready" | "error" | "disposed";

export interface BroadcastRootStatus {
  readonly phase: BroadcastRootPhase;
  readonly commitRevision: number;
  readonly compiledRevision?: number;
  readonly diagnostics: readonly Diagnostic[];
  readonly message?: string;
}

export class RootStatusStore {
  readonly #listeners = new Set<() => void>();
  #status: BroadcastRootStatus = {
    phase: "idle",
    commitRevision: 0,
    diagnostics: [],
  };

  getSnapshot(): BroadcastRootStatus {
    return this.#status;
  }

  set(status: BroadcastRootStatus): void {
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
