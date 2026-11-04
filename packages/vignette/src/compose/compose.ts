import { createElement, isValidElement, type ComponentType, type ReactElement } from "react";
import { createActor, fromPromise, type SnapshotFrom } from "xstate";

import type { AssetManifest } from "../core/assets.js";
import { diagnostic, sortDiagnostics, type Diagnostic } from "../core/diagnostics.js";
import { compileShow } from "../core/layout/compile.js";
import type { LayoutEngine } from "../core/layout/layout-engine.js";
import { deepFreeze } from "../core/objects.js";
import { PLAIN_LAYER_KIND } from "../core/define-layer.js";
import type { Canvas, Snapshot } from "../core/snapshot.js";
import { validateShow } from "../core/validate.js";
import type { HostContainer } from "../react-authoring/host-types.js";
import { lowerShow } from "../react-authoring/lower.js";
import { reconciler } from "../react-authoring/reconciler.js";
import { StreamHub } from "../stream/hub.js";
import { sourceStream, type StreamOptions } from "../stream/source-stream.js";
import type { Serve, SetupMessage, ShowEvent, StreamMessage } from "../stream/messages.js";
import {
  composerMachine,
  type CompileFailure,
  type CompileResult,
  type ComposerPhase,
} from "./machine.js";
import { clearReactMeasures } from "./react-measures.js";

export type { ComposerPhase } from "./machine.js";

/** Host options for {@link compose}. Nothing here is read from the environment. */
export interface ComposeOptions {
  /** The asset manifest from `bundle`, or `scanAssets(dir)`. Published in setup. */
  readonly assets?: AssetManifest;
  /** Absolute URLs where the stream, assets and `frames.html` are served. Published in setup. */
  readonly serve?: Serve;
  /** A layout engine from `loadYoga`, for hosts that cannot compile wasm at runtime. */
  readonly layout?: LayoutEngine;
  /** Called with every render and compile error; the same errors appear in `status`. */
  readonly onError?: (error: Error) => void;
}

/** Compile phase, revisions and diagnostics of a composer, as an external store snapshot. */
export interface ComposerStatus {
  readonly phase: ComposerPhase;
  /** The latest React commit. */
  readonly revision: number;
  /** The latest commit that compiled into a snapshot. */
  readonly compiledRevision?: number;
  /** Why the latest compile failed, or warnings from the latest successful one. */
  readonly diagnostics: readonly Diagnostic[];
  /** The latest render or compile error, until a newer commit compiles. */
  readonly error?: Error;
}

/** A running show: React in this process, compiled into snapshots, published as a stream. */
export interface Composer {
  /**
   * The stream: setup and the latest update replayed, then live messages until `signal` aborts or
   * the composer is disposed. Setup is published before the first update, once the first commit
   * has compiled (its show ID, canvas and kinds come from the show), and again only when the
   * show starts using a source kind no setup listed. A disposed composer's stream is empty.
   * `options.source` narrows it to one source, as a frame page's `?source=` asks.
   */
  stream(signal?: AbortSignal, options?: StreamOptions): AsyncIterable<StreamMessage>;
  /** The latest compiled snapshot. */
  readonly snapshot: Snapshot | undefined;
  /** Resolves after the first successful compile; rejects if the first render or compile fails. */
  ready(): Promise<Snapshot>;
  /** Flushes pending synchronous React work and resolves with the snapshot compiled from it. */
  settled(): Promise<Snapshot>;
  /** Settles, disposes, and returns the snapshot. */
  once(): Promise<Snapshot>;
  /** Publishes a one-shot event; events never change desired state. */
  emit(event: ShowEvent): void;
  /** Current status; a new object only when something changed. */
  readonly status: ComposerStatus;
  /** Calls `listener` whenever `status` changes; `useSyncExternalStore` shape. */
  subscribe(listener: () => void): () => void;
  /** Unmounts the show (running effect cleanups), rejects waiters and ends every stream. */
  dispose(): void;
}

/**
 * Starts composing a show: renders it in a React root in this process and compiles each commit
 * into a snapshot. `show` is the `<Show>` element a show file default-exports, or a component
 * that renders one.
 *
 * A composer is one show for its whole lifetime. Its `setup` is published once, after the first
 * successful compile, and re-published only when a later snapshot uses a source kind the
 * previous setup lacked (a show may conditionally render a new kind; its `kinds` are then the
 * union of every kind used so far). Once a snapshot has compiled, a commit whose `<Show>` has a
 * different `id` or `canvas` does not compile: it fails with `SHOW_IDENTITY_CHANGED` and the
 * last snapshot stays live. A host that wants another show composes it anew.
 *
 * ```ts
 * const composer = compose(show, { assets: manifest, serve });
 * await composer.ready();
 * ```
 */
export function compose(
  show: ReactElement | ComponentType,
  options: ComposeOptions = {},
): Composer {
  const element = isValidElement(show) ? show : createElement(show);
  const hub = new StreamHub();
  const listeners = new Set<() => void>();
  let setup: SetupMessage | undefined = undefined;

  const container: HostContainer = {
    children: [],
    commitRevision: 0,
    commitActive: false,
    onCommit: (revision) => {
      if (live()) actor.send({ type: "committed", revision });
    },
  };

  const actor = createActor(
    composerMachine.provide({
      actors: {
        compile: fromPromise(({ input }) => compileRevision(container, input, options)),
      },
      actions: {
        publish: (_, snapshot) => {
          publish(snapshot);
        },
        report: (_, error) => {
          options.onError?.(error);
        },
        close: () => {
          hub.close();
        },
      },
    }),
  );
  let status = toStatus(actor.getSnapshot());
  actor.subscribe((snapshot) => {
    const next = toStatus(snapshot);
    if (sameStatus(status, next)) return;
    status = next;
    for (const listener of [...listeners]) listener();
  });
  actor.start();
  const live = () => actor.getSnapshot().status === "active";

  /**
   * Setup precedes the first update and is republished only when a new kind appears. Each publish
   * also drops what React's development build measured for the commit, which would otherwise pile
   * up in a long-running server.
   */
  function publish(snapshot: Snapshot): void {
    clearReactMeasures();
    // Source kinds and layer kinds share the list: a target needs a plugin for each.
    const kinds = [
      ...snapshot.sources.map((source) => source.kind),
      ...snapshot.scenes.flatMap((scene) => scene.items.map((item) => item.kind)),
    ].filter((kind) => kind !== PLAIN_LAYER_KIND);
    if (setup === undefined || kinds.some((kind) => !setup?.kinds.includes(kind))) {
      setup = setupFor(snapshot, [...(setup?.kinds ?? []), ...kinds], options);
      hub.publish(setup);
    }
    hub.publish({ kind: "update", snapshot });
  }

  /** Resolves once `revision` compiled; rejects once it failed or the composer is disposed. */
  function awaitRevision(revision: number): Promise<Snapshot> {
    return new Promise((resolve, reject) => {
      const check = (snapshot: ComposerSnapshot): boolean => {
        const outcome = settlement(snapshot, revision);
        if (outcome === undefined) return false;
        if (outcome instanceof Error) reject(outcome);
        else resolve(outcome);
        return true;
      };
      if (check(actor.getSnapshot())) return;
      const subscription = actor.subscribe((snapshot) => {
        if (check(snapshot)) subscription.unsubscribe();
      });
    });
  }

  // The reconciler root is opaque; it is only passed back to the same reconciler.
  const root: unknown = reconciler.createContainer(
    container,
    1, // ConcurrentRoot
    null,
    false,
    null,
    "vignette-",
    (error) => {
      if (!live()) return;
      actor.send({
        type: "renderFailed",
        revision: container.commitRevision,
        error: toError(error),
      });
    },
    (error) => {
      // An error boundary handled it and the show still rendered; report it and carry on.
      options.onError?.(toError(error));
    },
    (error) => {
      options.onError?.(toError(error));
    },
    () => undefined,
  );
  // Render synchronously so the first commit exists once compose() returns.
  reconciler.updateContainerSync(element, root, null, null);
  reconciler.flushSyncWork();

  function settled(): Promise<Snapshot> {
    if (live()) {
      // Run pending synchronous updates, such as external-store changes, so the commit they
      // produce is the one awaited below.
      reconciler.flushSyncFromReconciler(() => undefined);
      reconciler.flushSyncWork();
    }
    return awaitRevision(Math.max(container.commitRevision, 1));
  }

  function dispose(): void {
    if (!live()) return;
    // Dispose first so the unmount commit below is ignored rather than compiled.
    actor.send({ type: "dispose" });
    listeners.clear();
    reconciler.updateContainerSync(null, root, null, null);
    reconciler.flushSyncWork();
  }

  return {
    stream: (signal, options) =>
      options?.source === undefined
        ? hub.subscribe(signal)
        : sourceStream(hub.subscribe(signal), options.source),
    get snapshot() {
      return actor.getSnapshot().context.snapshot;
    },
    ready: () => awaitRevision(1),
    settled,
    async once() {
      try {
        return await settled();
      } finally {
        dispose();
      }
    },
    emit(event) {
      if (!live()) throw new Error("The composer is disposed.");
      hub.publish({ kind: "event", event });
    },
    get status() {
      return status;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose,
  };
}

/** A state of the composer machine. */
type ComposerSnapshot = SnapshotFrom<typeof composerMachine>;

/** The snapshot a waiter for `revision` resolves with, the error it rejects with, or nothing yet. */
function settlement(snapshot: ComposerSnapshot, revision: number): Snapshot | Error | undefined {
  const { compiledRevision = 0, snapshot: compiled, failure } = snapshot.context;
  if (snapshot.status !== "active") return new Error("The composer is disposed.");
  if (compiled !== undefined && compiledRevision >= revision) return compiled;
  return failure !== undefined && failure.revision >= revision ? failure.error : undefined;
}

/**
 * Lowers the latest commit, holds it to the show's identity, validates, lays out and compiles
 * it. Starts after a microtask, so the commit that scheduled it has finished.
 */
async function compileRevision(
  container: HostContainer,
  identity: Snapshot | undefined,
  options: ComposeOptions,
): Promise<CompileResult> {
  await Promise.resolve();
  const revision = container.commitRevision;
  try {
    // Lower before any await so the snapshot is of exactly this commit's tree.
    const lowered = lowerShow(container);
    const tree = lowered.tree;
    if (tree !== undefined && identity !== undefined && !sameIdentity(identity, tree)) {
      return failure(revision, [identityChanged(identity, tree)]);
    }
    const diagnostics = sortDiagnostics([
      ...lowered.diagnostics,
      ...(tree === undefined
        ? []
        : validateShow(tree, {
            definitions: lowered.definitions,
            assets: options.assets,
            serve: options.serve,
          })),
    ]);
    if (tree === undefined || diagnostics.some(isError)) {
      return failure(revision, diagnostics);
    }
    const layoutEngine = options.layout ?? (await loadDefaultLayoutEngine());
    const result = compileShow(tree, { revision, layoutEngine });
    if (!result.ok) return failure(revision, result.diagnostics);
    return { ok: true, revision, snapshot: result.snapshot, diagnostics: result.diagnostics };
  } catch (cause) {
    return { ok: false, revision, error: toError(cause), diagnostics: [] };
  }
}

/** The show's identity, held to the first snapshot. */
interface ShowIdentity {
  readonly id: string;
  readonly canvas: Canvas;
}

function sameIdentity(left: ShowIdentity, right: ShowIdentity): boolean {
  return (
    left.id === right.id &&
    left.canvas.width === right.canvas.width &&
    left.canvas.height === right.canvas.height &&
    left.canvas.frameRate === right.canvas.frameRate
  );
}

function identityChanged(before: ShowIdentity, after: ShowIdentity): Diagnostic {
  const describe = ({ id, canvas }: ShowIdentity) =>
    `"${id}" ${String(canvas.width)}x${String(canvas.height)}`;
  return diagnostic(
    "SHOW_IDENTITY_CHANGED",
    "error",
    "show",
    `A composer composes one show: ${describe(before)} cannot become ${describe(after)}. Compose the new show with a new composer.`,
  );
}

function failure(revision: number, diagnostics: readonly Diagnostic[]): CompileFailure {
  const messages = diagnostics.map((item) => `${item.path}: ${item.message}`);
  const error = new Error(`The show did not compile.\n${messages.join("\n")}`);
  return { ok: false, revision, error, diagnostics };
}

function isError(item: Diagnostic): boolean {
  return item.severity === "error";
}

const EMPTY_MANIFEST: AssetManifest = { version: "empty", entries: [] };

/** The setup message for a snapshot: `kinds` plus the host's manifest and locations. */
function setupFor(
  snapshot: Snapshot,
  kinds: readonly string[],
  options: ComposeOptions,
): SetupMessage {
  const assets = options.assets ?? EMPTY_MANIFEST;
  // Setup crosses into targets, so it is frozen; copy the host's objects rather than freeze them.
  return deepFreeze({
    kind: "setup",
    id: snapshot.id,
    canvas: snapshot.canvas,
    kinds: [...new Set(kinds)].sort(),
    assets: { version: assets.version, entries: assets.entries.map((entry) => ({ ...entry })) },
    serve: { ...options.serve },
  });
}

const PHASES = ["idle", "ready", "error", "disposed"] as const;

function toStatus(snapshot: ComposerSnapshot): ComposerStatus {
  const { context } = snapshot;
  return {
    // `compiled` is transient, so anything not named is `compiling`.
    phase: PHASES.find((phase) => snapshot.matches(phase)) ?? "compiling",
    revision: context.commitRevision,
    compiledRevision: context.compiledRevision,
    diagnostics: context.diagnostics,
    error: context.failure?.error,
  };
}

/** Field-wise equality, so `status` keeps its identity until something observable changes. */
function sameStatus(left: ComposerStatus, right: ComposerStatus): boolean {
  return (
    left.phase === right.phase &&
    left.revision === right.revision &&
    left.compiledRevision === right.compiledRevision &&
    left.diagnostics === right.diagnostics &&
    left.error === right.error
  );
}

/** The engine module the composer imports lazily, only when the host passes no `layout`. */
interface DefaultLayoutModule {
  readonly yogaLayoutEngine: LayoutEngine;
}

let defaultLayoutEngine: Promise<LayoutEngine> | undefined = undefined;

function loadDefaultLayoutEngine(): Promise<LayoutEngine> {
  // A literal specifier so bundlers include the engine; hosts that pass `layout` never evaluate it.
  defaultLayoutEngine ??= import("../core/layout/yoga.js").then(
    (module: DefaultLayoutModule) => module.yogaLayoutEngine,
  );
  return defaultLayoutEngine;
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
