import { omitUndefined } from "@strangecyan/vignette-core";
import {
  compileBroadcast,
  deepFreeze,
  extensionSourceKinds,
  resolveSourceModules,
  StreamHub,
  type AssetManifest,
  type CompiledSnapshot,
  type Diagnostic,
  type LayoutEngine,
  type StreamEvent,
  type StreamMessage,
  type SourceModuleMap,
} from "@strangecyan/vignette-core";
import { createElement, type ReactNode } from "react";

import type { CompositionDefinition } from "./composition.js";
import { hostTreeToBroadcast } from "./host-tree.js";
import type { HostContainer } from "./host-types.js";
import { reconciler } from "./reconciler.js";
import { ComposerStatusStore, type ComposerStatus } from "./status.js";

interface ComposerRootImplCompileFailure {
  readonly revision: number;
  readonly error: Error;
}

interface LoadDefaultLayoutEngineModule {
  yogaLayoutEngine: LayoutEngine;
}

/** Host-owned settings for a composer root; identity comes from the composition. */
export interface ComposerRootOptions {
  readonly strictMode?: boolean | undefined;
  /** Layout implementation. Defaults to the yoga-layout binding when omitted. */
  readonly layoutEngine?: LayoutEngine | undefined;
  /** Assets required by this composition. Fixed for the root's lifetime. */
  readonly assets?: AssetManifest | undefined;
  readonly onError?: ((error: Error) => void) | undefined;
}

/** Revisions and the compiled snapshot associated with one completed React commit. */
export interface CommitReceipt {
  readonly requestedRevision: number;
  readonly compiledRevision: number;
  readonly compiledAt: number;
  /** The snapshot compiled for this commit (or a newer one that superseded it). */
  readonly snapshot: CompiledSnapshot;
}

/** Persistent Node-side React root that compiles a composition and publishes its stream. */
export interface ComposerRoot {
  /**
   * Renders the composition's component, or `element` when supplied (for hosts that wrap the
   * component in providers, or tests that render ad hoc trees). Resolves once the commit is
   * compiled, so `(await root.render()).snapshot` and `root.snapshot` are current.
   */
  render(element?: ReactNode): Promise<CommitReceipt>;
  /** The latest compiled snapshot, or undefined before the first successful compile. */
  readonly snapshot: CompiledSnapshot | undefined;
  settled(): Promise<CompiledSnapshot>;
  /** The composer stream: replays setup and the latest update, then follows live messages. */
  messages(signal?: AbortSignal): AsyncIterable<StreamMessage>;
  snapshots(signal?: AbortSignal): AsyncIterable<CompiledSnapshot>;
  publishEvent(event: StreamEvent): void;
  getStatus(): ComposerStatus;
  subscribe(listener: (snapshot: CompiledSnapshot) => void): () => void;
  subscribeStatus(listener: () => void): () => void;
  unmount(): Promise<CommitReceipt>;
  dispose(): Promise<void>;
}

interface CompileWaiter {
  readonly revision: number;
  readonly resolve: (receipt: CommitReceipt) => void;
  readonly reject: (error: Error) => void;
}

/** Creates a persistent React composer for one composition. */
export function createComposerRoot(
  composition: CompositionDefinition,
  options: ComposerRootOptions = {},
): ComposerRoot {
  return new ComposerRootImpl(composition, options);
}

/** Options for a one-shot {@link compile}. */
export interface CompileCompositionOptions extends ComposerRootOptions {
  /** Element to render instead of the composition's component, e.g. one wrapped in providers. */
  readonly element?: ReactNode | undefined;
}

/**
 * Renders a composition once and resolves to its settled snapshot, disposing the root afterwards.
 * Useful for tests, scripts, and static exports; rejects when rendering or compilation fails.
 * State updates scheduled later by effects (timers, fetches) are not awaited; use a persistent
 * `createComposerRoot` for live compositions.
 *
 * ```ts
 * const snapshot = await compile(composition);
 * ```
 */
export async function compile(
  composition: CompositionDefinition,
  options: CompileCompositionOptions = {},
): Promise<CompiledSnapshot> {
  const { element, ...rootOptions } = options;
  const root = createComposerRoot(composition, rootOptions);
  try {
    await (element === undefined ? root.render() : root.render(element));
    return await root.settled();
  } finally {
    await root.dispose();
  }
}

class ComposerRootImpl implements ComposerRoot {
  private readonly composition: CompositionDefinition;
  private readonly options: ComposerRootOptions;
  private readonly modules: SourceModuleMap;
  private readonly container: HostContainer;
  private readonly internalRoot: unknown;
  private readonly compileWaiters = new Set<CompileWaiter>();
  private readonly renderRejectors = new Set<(error: Error) => void>();
  private readonly renderFailures = new Map<number, Error>();
  private readonly snapshotListeners = new Set<(snapshot: CompiledSnapshot) => void>();
  private readonly status = new ComposerStatusStore();
  private readonly messageHub = new StreamHub();
  private currentSnapshot: CompiledSnapshot | undefined;
  private compileScheduled = false;
  private compiledRevision = -1;
  private disposed = false;
  private compileFailure: ComposerRootImplCompileFailure | undefined;

  constructor(composition: CompositionDefinition, options: ComposerRootOptions) {
    this.composition = composition;
    this.options = options;
    const manifest: AssetManifest = {
      version: options.assets?.version ?? 1,
      assets: (options.assets?.assets ?? []).map((asset) => ({ ...asset })),
    };
    this.messageHub.publish(
      deepFreeze({
        kind: "setup",
        projectId: composition.id,
        manifest,
        extensions: extensionSourceKinds(composition.extensions),
      }),
    );
    this.modules = resolveSourceModules(composition.extensions);
    this.container = {
      projectId: composition.id,
      canvas: composition.canvas,
      children: [],
      commitRevision: 0,
      commitActive: false,
      onCommit: () => {
        this.scheduleCompile();
      },
    };
    this.internalRoot =
      /* SAFETY: The reconciler root is opaque to Vignette and is only passed back to the same reconciler instance. */ reconciler.createContainer(
        this.container,
        1,
        null,
        options.strictMode ?? false,
        null,
        "vignette-",
        (error) => {
          this.handleRenderError(error);
        },
        (error) => {
          this.handleRenderError(error);
        },
        (error) => {
          this.options.onError?.(error);
        },
        () => undefined,
      ) as unknown;
  }

  render(element: ReactNode = createElement(this.composition.component)): Promise<CommitReceipt> {
    this.assertActive();
    return new Promise<CommitReceipt>((resolve, reject) => {
      let renderFailed = false;
      const rejectRender = (error: Error) => {
        renderFailed = true;
        reject(error);
      };
      this.renderRejectors.add(rejectRender);
      reconciler.updateContainer(element, this.internalRoot, null, () => {
        this.renderRejectors.delete(rejectRender);
        if (renderFailed) return;
        this.waitForCompile(this.container.commitRevision).then((receipt) => {
          reconciler.flushPassiveEffects();
          resolve(receipt);
        }, reject);
      });
    });
  }

  get snapshot(): CompiledSnapshot | undefined {
    return this.currentSnapshot;
  }

  async settled(): Promise<CompiledSnapshot> {
    this.assertActive();
    reconciler.flushSyncFromReconciler(() => undefined);
    reconciler.flushSyncWork();
    await this.waitForCompile(this.container.commitRevision);
    if (this.currentSnapshot === undefined) {
      throw new Error("Composer root has not rendered a snapshot.");
    }
    return this.currentSnapshot;
  }

  messages(signal?: AbortSignal): AsyncIterable<StreamMessage> {
    this.assertActive();
    return this.messageHub.subscribe(signal);
  }

  async *snapshots(signal?: AbortSignal): AsyncIterable<CompiledSnapshot> {
    for await (const message of this.messages(signal)) {
      if (message.kind === "update") yield message.snapshot;
    }
  }

  publishEvent(event: StreamEvent): void {
    this.assertActive();
    this.messageHub.publish({ kind: "event", event });
  }

  getStatus(): ComposerStatus {
    return this.status.getSnapshot();
  }

  subscribe(listener: (snapshot: CompiledSnapshot) => void): () => void {
    this.assertActive();
    this.snapshotListeners.add(listener);
    if (this.currentSnapshot !== undefined) listener(this.currentSnapshot);
    return () => this.snapshotListeners.delete(listener);
  }

  subscribeStatus(listener: () => void): () => void {
    return this.status.subscribe(listener);
  }

  unmount(): Promise<CommitReceipt> {
    return this.render(null);
  }

  /** Unmount active authoring nodes before closing streams, rejecting receipts, and disposing targets. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    if (this.container.children.length > 0) await this.unmount();
    this.disposed = true;
    const error = new Error("Composer root is disposed.");
    this.rejectCompileWaiters(error);
    for (const reject of this.renderRejectors) reject(error);
    this.renderRejectors.clear();
    this.renderFailures.clear();
    this.messageHub.close();
    this.snapshotListeners.clear();
    this.currentSnapshot = undefined;
    this.status.set({
      phase: "disposed",
      commitRevision: this.container.commitRevision,
      ...omitUndefined({
        compiledRevision: this.compiledRevision < 0 ? undefined : this.compiledRevision,
      }),
      diagnostics: [],
    });
    this.status.clear();
  }

  private scheduleCompile(): void {
    if (this.compileScheduled || this.disposed) return;
    this.compileScheduled = true;
    this.status.set({
      phase: "compiling",
      commitRevision: this.container.commitRevision,
      ...omitUndefined({
        compiledRevision: this.compiledRevision < 0 ? undefined : this.compiledRevision,
      }),
      diagnostics: [],
    });
    queueMicrotask(() => {
      this.compileScheduled = false;
      void this.compileLatest();
    });
  }

  /** Compile the latest committed revision, preserving render failures and rejecting superseded receipts. */
  private async compileLatest(): Promise<void> {
    if (this.disposed) return;
    const revision = this.container.commitRevision;
    const renderFailure = this.renderFailures.get(revision);
    if (renderFailure !== undefined) {
      this.renderFailures.delete(revision);
      this.failCompile(revision, renderFailure, []);
      return;
    }

    if (this.container.children.length === 0) {
      this.publish(emptySnapshot(this.composition, revision), []);
      return;
    }

    try {
      const layoutEngine = this.options.layoutEngine ?? (await loadDefaultLayoutEngine());
      if (this.isDisposed()) return;
      const result = compileBroadcast(hostTreeToBroadcast(this.container), {
        revision,
        modules: this.modules,
        layoutEngine,
      });
      if (!result.ok) throw new CompileFailure(result.diagnostics);
      this.publish(result.snapshot, result.diagnostics);
    } catch (cause) {
      const error = toError(cause);
      this.failCompile(revision, error, cause instanceof CompileFailure ? cause.diagnostics : []);
    }
  }

  private publish(snapshot: CompiledSnapshot, diagnostics: readonly Diagnostic[]): void {
    this.currentSnapshot = snapshot;
    this.compiledRevision = snapshot.revision;
    this.compileFailure = undefined;
    this.messageHub.publish({ kind: "update", snapshot });
    this.status.set({
      phase: "ready",
      commitRevision: snapshot.revision,
      compiledRevision: snapshot.revision,
      diagnostics: [...diagnostics],
    });
    for (const listener of this.snapshotListeners) listener(snapshot);
    for (const waiter of this.compileWaiters) {
      if (waiter.revision > snapshot.revision) continue;
      waiter.resolve(this.receipt(waiter.revision, snapshot));
      this.compileWaiters.delete(waiter);
    }
  }

  private failCompile(revision: number, error: Error, diagnostics: readonly Diagnostic[]): void {
    this.compileFailure = { revision, error };
    this.status.set({
      phase: "error",
      commitRevision: revision,
      ...omitUndefined({
        compiledRevision: this.compiledRevision < 0 ? undefined : this.compiledRevision,
      }),
      diagnostics: [...diagnostics],
      message: error.message,
    });
    this.options.onError?.(error);
    this.rejectCompileWaiters(error, revision);
  }

  /** Resolve from the current snapshot, reject a recorded failure, or wait for the revision to compile. */
  private waitForCompile(revision: number): Promise<CommitReceipt> {
    if (this.disposed) return Promise.reject(new Error("Composer root is disposed."));
    if (this.compiledRevision >= revision && this.currentSnapshot !== undefined) {
      return Promise.resolve(this.receipt(revision, this.currentSnapshot));
    }
    if (this.compileFailure !== undefined && this.compileFailure.revision >= revision) {
      return Promise.reject(this.compileFailure.error);
    }
    return new Promise((resolve, reject) => {
      this.compileWaiters.add({ revision, resolve, reject });
    });
  }

  private receipt(requestedRevision: number, snapshot: CompiledSnapshot): CommitReceipt {
    return {
      requestedRevision,
      compiledRevision: this.compiledRevision,
      compiledAt: Date.now(),
      snapshot,
    };
  }

  private handleRenderError(error: Error): void {
    const revision = this.container.commitRevision;
    this.renderFailures.set(revision, error);
    this.options.onError?.(error);
    for (const reject of this.renderRejectors) reject(error);
    this.renderRejectors.clear();
    this.rejectCompileWaiters(error, revision);
  }

  private rejectCompileWaiters(error: Error, upToRevision = Number.POSITIVE_INFINITY): void {
    for (const waiter of this.compileWaiters) {
      if (waiter.revision > upToRevision) continue;
      waiter.reject(error);
      this.compileWaiters.delete(waiter);
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("Composer root is disposed.");
  }

  private isDisposed(): boolean {
    return this.disposed;
  }
}

let defaultLayoutEngine: Promise<LayoutEngine> | undefined = undefined;

function loadDefaultLayoutEngine(): Promise<LayoutEngine> {
  // A literal, analyzable specifier: bundlers must include the engine (resolved under the host's
  // export conditions, e.g. `workerd`) because bundled Workers cannot resolve bare imports at runtime.
  defaultLayoutEngine ??= import("@strangecyan/vignette-core/layout-yoga").then(
    (module: LoadDefaultLayoutEngineModule) => Promise.resolve(module.yogaLayoutEngine),
  );
  return defaultLayoutEngine;
}

class CompileFailure extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(diagnostics: readonly Diagnostic[]) {
    super(diagnostics.map((item) => item.message).join(" "));
    this.name = "CompileFailure";
    this.diagnostics = diagnostics;
  }
}

function emptySnapshot(composition: CompositionDefinition, revision: number): CompiledSnapshot {
  return {
    revision,
    projectId: composition.id,
    canvas: { ...composition.canvas },
    sources: [],
    scenes: [],
    warnings: [],
  };
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error("Scene composition failed.", { cause });
}
