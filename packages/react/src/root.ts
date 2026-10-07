import { omitUndefined } from "@strangecyan/vignette-core";
import {
  compileBroadcast,
  deepFreeze,
  extensionSourceKinds,
  resolveSourceModules,
  RuntimeMessageHub,
  type AssetManifest,
  type CompiledSnapshot,
  type Diagnostic,
  type LayoutEngine,
  type RuntimeEvent,
  type RuntimeMessage,
  type SourceModuleMap,
} from "@strangecyan/vignette-core";
import { createElement, type ReactNode } from "react";

import type { CompositionDefinition } from "./composition.js";
import { hostTreeToBroadcast } from "./host-tree.js";
import type { HostContainer } from "./host-types.js";
import { reconciler } from "./reconciler.js";
import { RootStatusStore, type BroadcastRootStatus } from "./status.js";

interface ComposerRootImplCompileFailure {
  readonly revision: number;
  readonly error: Error;
}

interface LoadDefaultLayoutEngineModule {
  yogaLayoutEngine: LayoutEngine;
}

/** Host-owned runtime settings for a composer root; identity comes from the composition. */
export interface ComposerRootOptions {
  readonly strictMode?: boolean;
  /** Layout implementation. Defaults to the yoga-layout binding when omitted. */
  readonly layoutEngine?: LayoutEngine;
  /** Assets required by this composition. Fixed for the root's lifetime. */
  readonly assets?: AssetManifest;
  readonly onError?: (error: Error) => void;
}

/** Revisions associated with one completed React commit and compilation. */
export interface CommitReceipt {
  readonly requestedRevision: number;
  readonly compiledRevision: number;
  readonly compiledAt: number;
}

/** Persistent Node-side React root that publishes compiled snapshots. */
export interface ComposerRoot {
  /**
   * Renders the composition's component, or `element` when supplied (for hosts that wrap the
   * component in providers, or tests that render ad hoc trees).
   */
  render(element?: ReactNode): Promise<CommitReceipt>;
  readonly snapshot: CompiledSnapshot | undefined;
  settled(): Promise<CompiledSnapshot>;
  messages(signal?: AbortSignal): AsyncIterable<RuntimeMessage>;
  snapshots(signal?: AbortSignal): AsyncIterable<CompiledSnapshot>;
  publishEvent(event: RuntimeEvent): void;
  getStatus(): BroadcastRootStatus;
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
  private readonly status = new RootStatusStore();
  private readonly messageHub = new RuntimeMessageHub();
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

  messages(signal?: AbortSignal): AsyncIterable<RuntimeMessage> {
    this.assertActive();
    return this.messageHub.subscribe(signal);
  }

  async *snapshots(signal?: AbortSignal): AsyncIterable<CompiledSnapshot> {
    for await (const message of this.messages(signal)) {
      if (message.kind === "update") yield message.snapshot;
    }
  }

  publishEvent(event: RuntimeEvent): void {
    this.assertActive();
    this.messageHub.publish({ kind: "event", event });
  }

  getStatus(): BroadcastRootStatus {
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
      waiter.resolve(this.receipt(waiter.revision));
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

  private waitForCompile(revision: number): Promise<CommitReceipt> {
    if (this.compiledRevision >= revision) return Promise.resolve(this.receipt(revision));
    if (this.compileFailure !== undefined && this.compileFailure.revision >= revision) {
      return Promise.reject(this.compileFailure.error);
    }
    return new Promise((resolve, reject) => {
      this.compileWaiters.add({ revision, resolve, reject });
    });
  }

  private receipt(requestedRevision: number): CommitReceipt {
    return {
      requestedRevision,
      compiledRevision: this.compiledRevision,
      compiledAt: Date.now(),
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
  defaultLayoutEngine ??= import(/* @vite-ignore */ "@strangecyan/vignette-core/layout-yoga").then(
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
