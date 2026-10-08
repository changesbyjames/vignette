import type { Diagnostic } from "@strangecyan/vignette-core";

/** Synchronous lifecycle phase of the Node composer root. */
export type ComposerPhase = "idle" | "compiling" | "ready" | "error" | "disposed";

/** Current React commit, compilation, and diagnostic state. */
export interface ComposerStatus {
  readonly phase: ComposerPhase;
  readonly commitRevision: number;
  readonly compiledRevision?: number;
  readonly diagnostics: readonly Diagnostic[];
  readonly message?: string;
}

/** Observable external store for composer status. */
export class ComposerStatusStore {
  private readonly listeners = new Set<() => void>();
  private status: ComposerStatus = {
    phase: "idle",
    commitRevision: 0,
    diagnostics: [],
  };

  getSnapshot(): ComposerStatus {
    return this.status;
  }

  set(status: ComposerStatus): void {
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
