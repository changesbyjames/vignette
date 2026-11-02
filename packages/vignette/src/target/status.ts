import type { ConnectionPhase } from "../stream/sse.js";

/**
 * Where a target is in its lifecycle. `connecting` and `disconnected` apply to targets that own a
 * connection (OBS); every target passes through `checking-plugins` and `downloading-assets` after
 * each setup, then alternates between `synchronising` and `settled` as updates arrive.
 */
export type TargetPhase =
  | "idle"
  | "connecting"
  | "checking-plugins"
  | "downloading-assets"
  | "synchronising"
  | "settled"
  | "error"
  | "disconnected"
  | "disposed";

/** The newest revision a target was asked for and the newest it has fully applied. */
export interface TargetRevision {
  readonly desired?: number;
  readonly settled?: number;
}

/** Progress of the asset stage that follows each setup. `failed` lists asset names. */
export interface TargetAssetProgress {
  readonly done: number;
  readonly total: number;
  readonly failed: readonly string[];
}

/**
 * The state of a target's connection to its medium or its stream: OBS's websocket, a page's SSE
 * connection. Reported by the medium through `CreateTargetOptions.connection`.
 */
export interface TargetConnection {
  readonly phase: ConnectionPhase;
  /** Why the last attempt failed, while `retry-wait` or `closed`. */
  readonly error?: Error;
}

/** Lifetime state of one source's plugin handle. */
export type SourceStatus = "preparing" | "live" | "error";

/**
 * Observable state of a target, read through `status` and watched through `subscribe`.
 * Failures are reported here, never thrown into the composer or the page.
 */
export interface TargetStatus {
  readonly phase: TargetPhase;
  readonly revision: TargetRevision;
  readonly assets?: TargetAssetProgress;
  /** Handle state per source ID. */
  readonly sources: Readonly<Record<string, SourceStatus>>;
  /** Why each `error` source failed: its plugin's `create` or `update` rejected. */
  readonly sourceErrors: Readonly<Record<string, Error>>;
  readonly error?: Error;
  /** The connection, for targets whose medium reports one. */
  readonly connection?: TargetConnection;
}
