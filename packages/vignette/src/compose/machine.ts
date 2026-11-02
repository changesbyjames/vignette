import { assign, enqueueActions, fromPromise, setup } from "xstate";

import type { Diagnostic } from "../core/diagnostics.js";
import type { Snapshot } from "../core/snapshot.js";

/** Lifecycle phase of a composer. */
export type ComposerPhase = "idle" | "compiling" | "ready" | "error" | "disposed";

/** The latest render or compile failure and the commit revision it belongs to. */
export interface Failure {
  readonly revision: number;
  readonly error: Error;
}

/** Composer context: the latest commit, the latest compiled snapshot, and the latest failure. */
export interface ComposerContext {
  readonly commitRevision: number;
  readonly compiledRevision?: number;
  readonly snapshot?: Snapshot;
  readonly diagnostics: readonly Diagnostic[];
  readonly failure?: Failure;
}

/** What one compile of the latest commit produced. */
export type CompileResult = CompileSuccess | CompileFailure;

/** `revision` compiled into `snapshot`. */
export interface CompileSuccess {
  readonly ok: true;
  readonly revision: number;
  readonly snapshot: Snapshot;
  readonly diagnostics: readonly Diagnostic[];
}

/** Lowering, validation or layout of `revision` failed. */
export interface CompileFailure {
  readonly ok: false;
  readonly revision: number;
  readonly error: Error;
  readonly diagnostics: readonly Diagnostic[];
}

/** React committed the host tree at `revision`. */
export interface CommittedEvent {
  readonly type: "committed";
  readonly revision: number;
}

/** React could not render the show; it unmounted the tree in the commit at `revision`. */
export interface RenderFailedEvent {
  readonly type: "renderFailed";
  readonly revision: number;
  readonly error: Error;
}

/** The composer is disposed. */
export interface DisposeEvent {
  readonly type: "dispose";
}

/** Everything that can happen to a composer. */
export type ComposerEvent = CommittedEvent | RenderFailedEvent | DisposeEvent;

/**
 * The composer (plan §6.1). `compose` provides `compile` (lowers the latest commit, given the
 * last compiled snapshot to hold the show's identity to) and the `publish`, `report` and `close`
 * actions. One compile runs at a time: commits during it only raise `commitRevision`, and a
 * compile that finishes behind the latest commit starts another, so bursts coalesce. Waiters are
 * not machine state; `compose` settles them from `compiledRevision`, `failure` and `status`.
 */
export const composerMachine = setup({
  types: {
    // SAFETY: XState reads these two only as type carriers.
    context: {} as ComposerContext,
    // SAFETY: as above.
    events: {} as ComposerEvent,
  },
  actors: {
    compile: fromPromise<CompileResult, Snapshot | undefined>(() => {
      throw new Error("compose provides `compile`.");
    }),
  },
  actions: {
    publish: (_args, _snapshot: Snapshot) => undefined,
    report: (_args, _error: Error) => undefined,
    close: () => undefined,
  },
  guards: {
    behind: ({ context }) => context.commitRevision > settledRevision(context),
    failed: ({ context }) => (context.failure?.revision ?? 0) > (context.compiledRevision ?? 0),
  },
}).createMachine({
  id: "composer",
  context: { commitRevision: 0, diagnostics: [] },
  initial: "idle",
  on: {
    committed: {
      target: ".compiling",
      actions: assign({ commitRevision: ({ event }) => event.revision }),
    },
    renderFailed: {
      target: ".error",
      actions: [
        assign({ failure: ({ event }) => ({ revision: event.revision, error: event.error }) }),
        { type: "report", params: ({ event }) => event.error },
      ],
    },
    dispose: ".disposed",
  },
  states: {
    idle: {},
    compiling: {
      on: { committed: { actions: assign({ commitRevision: ({ event }) => event.revision }) } },
      invoke: {
        src: "compile",
        input: ({ context }) => context.snapshot,
        onDone: {
          target: "compiled",
          actions: enqueueActions(({ context, event: { output }, enqueue }) => {
            // Success publishes and clears an older failure; failure keeps the snapshot and
            // reports.
            if (output.ok) {
              // A newer failure (a render error) outlives an older snapshot.
              const failure =
                (context.failure?.revision ?? 0) > output.revision ? context.failure : undefined;
              enqueue.assign({
                compiledRevision: output.revision,
                snapshot: output.snapshot,
                diagnostics: output.diagnostics,
                failure,
              });
              enqueue({ type: "publish", params: output.snapshot });
            } else {
              enqueue.assign({
                diagnostics: output.diagnostics,
                failure: { revision: output.revision, error: output.error },
              });
              enqueue({ type: "report", params: output.error });
            }
          }),
        },
      },
    },
    // Transient: compile again if commits arrived meanwhile, else report the outcome.
    compiled: {
      always: [
        { guard: "behind", target: "compiling" },
        { guard: "failed", target: "error" },
        { target: "ready" },
      ],
    },
    ready: {},
    error: {},
    disposed: { type: "final", entry: "close" },
  },
});

/** The newest revision that compiled or failed. */
function settledRevision(context: ComposerContext): number {
  return Math.max(context.compiledRevision ?? 0, context.failure?.revision ?? 0);
}
