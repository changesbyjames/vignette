import type { CompiledSnapshot } from "./snapshot.js";

/** Observable lifecycle phase of an asynchronous target. */
export type TargetPhase =
  | "disconnected"
  | "connecting"
  | "synchronising"
  | "settled"
  | "paused"
  | "error"
  | "disposed";

/** Current convergence state of a rendering target. */
export interface TargetStatus {
  readonly phase: TargetPhase;
  /** Latest revision the target has settled, or 0 before it settles any. */
  readonly revision: number;
  /** Explanation for `error`, `paused`, and `disconnected` phases. */
  readonly message?: string;
}

/** Asynchronous consumer of immutable compiled snapshots. */
export interface RenderTarget {
  readonly id: string;
  publish(snapshot: CompiledSnapshot): void;
  /** Resolves once the target has settled `revision` or a newer one; rejects if it fails. */
  whenSettled(revision: number): Promise<void>;
  getStatus(): TargetStatus;
  subscribe(listener: () => void): () => void;
  dispose(): Promise<void>;
}
