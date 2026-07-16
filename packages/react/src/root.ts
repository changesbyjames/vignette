import {
  compileBroadcast,
  resolveSourceModules,
  type BroadcastCanvas,
  type CompiledSnapshot,
  type Diagnostic,
  type ProjectId,
  type SourceModule,
  type SourceModuleMap,
} from "@cbj/react-obs-core";
import type { ReactNode } from "react";

import { hostTreeToBroadcast } from "./host-tree.js";
import type { HostContainer } from "./host-types.js";
import { reconciler } from "./reconciler.js";
import { RootStatusStore, type BroadcastRootStatus } from "./status.js";

export interface ComposerRootOptions {
  readonly projectId: ProjectId;
  readonly canvas: BroadcastCanvas;
  readonly strictMode?: boolean;
  /** Source modules contributed by extension packages (built-ins are always registered). */
  readonly extensions?: readonly SourceModule[];
  readonly onError?: (error: Error) => void;
}

export interface CommitReceipt {
  readonly requestedRevision: number;
  readonly compiledRevision: number;
  readonly compiledAt: number;
}

export interface ComposerRoot {
  render(element: ReactNode): Promise<CommitReceipt>;
  getSnapshot(): CompiledSnapshot | undefined;
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

export function createComposerRoot(options: ComposerRootOptions): ComposerRoot {
  return new ComposerRootImpl(options);
}

class ComposerRootImpl implements ComposerRoot {
  readonly #options: ComposerRootOptions;
  readonly #modules: SourceModuleMap;
  readonly #container: HostContainer;
  readonly #internalRoot: unknown;
  readonly #compileWaiters = new Set<CompileWaiter>();
  readonly #renderRejectors = new Set<(error: Error) => void>();
  readonly #renderFailures = new Map<number, Error>();
  readonly #snapshotListeners = new Set<(snapshot: CompiledSnapshot) => void>();
  readonly #status = new RootStatusStore();
  #snapshot: CompiledSnapshot | undefined;
  #compileScheduled = false;
  #compiledRevision = -1;
  #disposed = false;

  constructor(options: ComposerRootOptions) {
    this.#options = options;
    this.#modules = resolveSourceModules(options.extensions);
    this.#container = {
      projectId: options.projectId,
      canvas: options.canvas,
      children: [],
      commitRevision: 0,
      commitActive: false,
      onCommit: () => {
        this.scheduleCompile();
      },
    };
    this.#internalRoot = reconciler.createContainer(
      this.#container,
      1,
      null,
      options.strictMode ?? false,
      null,
      "react-obs-",
      (error) => {
        this.handleRenderError(error);
      },
      (error) => {
        this.handleRenderError(error);
      },
      (error) => {
        this.#options.onError?.(error);
      },
      () => undefined,
    ) as unknown;
  }

  render(element: ReactNode): Promise<CommitReceipt> {
    this.assertActive();
    return new Promise<CommitReceipt>((resolve, reject) => {
      let renderFailed = false;
      const rejectRender = (error: Error) => {
        renderFailed = true;
        reject(error);
      };
      this.#renderRejectors.add(rejectRender);
      reconciler.updateContainer(element, this.#internalRoot, null, () => {
        this.#renderRejectors.delete(rejectRender);
        if (renderFailed) return;
        this.waitForCompile(this.#container.commitRevision).then(resolve, reject);
      });
    });
  }

  getSnapshot(): CompiledSnapshot | undefined {
    return this.#snapshot;
  }

  getStatus(): BroadcastRootStatus {
    return this.#status.getSnapshot();
  }

  subscribe(listener: (snapshot: CompiledSnapshot) => void): () => void {
    this.assertActive();
    this.#snapshotListeners.add(listener);
    if (this.#snapshot !== undefined) listener(this.#snapshot);
    return () => this.#snapshotListeners.delete(listener);
  }

  subscribeStatus(listener: () => void): () => void {
    return this.#status.subscribe(listener);
  }

  unmount(): Promise<CommitReceipt> {
    return this.render(null);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    if (this.#container.children.length > 0) await this.unmount();
    this.#disposed = true;
    const error = new Error("Composer root is disposed.");
    this.rejectCompileWaiters(error);
    for (const reject of this.#renderRejectors) reject(error);
    this.#renderRejectors.clear();
    this.#renderFailures.clear();
    this.#snapshotListeners.clear();
    this.#snapshot = undefined;
    this.#status.set({
      phase: "disposed",
      commitRevision: this.#container.commitRevision,
      ...(this.#compiledRevision < 0 ? {} : { compiledRevision: this.#compiledRevision }),
      diagnostics: [],
    });
    this.#status.clear();
  }

  private scheduleCompile(): void {
    if (this.#compileScheduled || this.#disposed) return;
    this.#compileScheduled = true;
    this.#status.set({
      phase: "compiling",
      commitRevision: this.#container.commitRevision,
      ...(this.#compiledRevision < 0 ? {} : { compiledRevision: this.#compiledRevision }),
      diagnostics: [],
    });
    queueMicrotask(() => {
      this.#compileScheduled = false;
      this.compileLatest();
    });
  }

  private compileLatest(): void {
    if (this.#disposed) return;
    const revision = this.#container.commitRevision;
    const renderFailure = this.#renderFailures.get(revision);
    if (renderFailure !== undefined) {
      this.#renderFailures.delete(revision);
      this.failCompile(revision, renderFailure, []);
      return;
    }

    if (this.#container.children.length === 0) {
      this.publish(emptySnapshot(this.#options, revision), []);
      return;
    }

    try {
      const result = compileBroadcast(hostTreeToBroadcast(this.#container), {
        revision,
        modules: this.#modules,
      });
      if (!result.ok) throw new CompileFailure(result.diagnostics);
      this.publish(result.snapshot, result.diagnostics);
    } catch (cause) {
      const error = toError(cause);
      this.failCompile(revision, error, cause instanceof CompileFailure ? cause.diagnostics : []);
    }
  }

  private publish(snapshot: CompiledSnapshot, diagnostics: readonly Diagnostic[]): void {
    this.#snapshot = snapshot;
    this.#compiledRevision = snapshot.revision;
    this.#status.set({
      phase: "ready",
      commitRevision: snapshot.revision,
      compiledRevision: snapshot.revision,
      diagnostics: [...diagnostics],
    });
    for (const listener of this.#snapshotListeners) listener(snapshot);
    for (const waiter of this.#compileWaiters) {
      if (waiter.revision > snapshot.revision) continue;
      waiter.resolve(this.receipt(waiter.revision));
      this.#compileWaiters.delete(waiter);
    }
  }

  private failCompile(revision: number, error: Error, diagnostics: readonly Diagnostic[]): void {
    this.#status.set({
      phase: "error",
      commitRevision: revision,
      ...(this.#compiledRevision < 0 ? {} : { compiledRevision: this.#compiledRevision }),
      diagnostics: [...diagnostics],
      message: error.message,
    });
    this.#options.onError?.(error);
    this.rejectCompileWaiters(error, revision);
  }

  private waitForCompile(revision: number): Promise<CommitReceipt> {
    if (this.#compiledRevision >= revision) return Promise.resolve(this.receipt(revision));
    return new Promise((resolve, reject) => {
      this.#compileWaiters.add({ revision, resolve, reject });
    });
  }

  private receipt(requestedRevision: number): CommitReceipt {
    return {
      requestedRevision,
      compiledRevision: this.#compiledRevision,
      compiledAt: Date.now(),
    };
  }

  private handleRenderError(error: Error): void {
    const revision = this.#container.commitRevision;
    this.#renderFailures.set(revision, error);
    this.#options.onError?.(error);
    for (const reject of this.#renderRejectors) reject(error);
    this.#renderRejectors.clear();
    this.rejectCompileWaiters(error, revision);
  }

  private rejectCompileWaiters(error: Error, upToRevision = Number.POSITIVE_INFINITY): void {
    for (const waiter of this.#compileWaiters) {
      if (waiter.revision > upToRevision) continue;
      waiter.reject(error);
      this.#compileWaiters.delete(waiter);
    }
  }

  private assertActive(): void {
    if (this.#disposed) throw new Error("Composer root is disposed.");
  }
}

class CompileFailure extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(diagnostics: readonly Diagnostic[]) {
    super(diagnostics.map((item) => item.message).join(" "));
    this.name = "CompileFailure";
    this.diagnostics = diagnostics;
  }
}

function emptySnapshot(options: ComposerRootOptions, revision: number): CompiledSnapshot {
  return {
    revision,
    projectId: options.projectId,
    canvas: { ...options.canvas },
    sources: [],
    scenes: [],
    warnings: [],
  };
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error("Scene composition failed.", { cause });
}
