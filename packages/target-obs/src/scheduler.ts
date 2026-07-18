import type {
  AssetResolver,
  Capability,
  CompiledSnapshot,
  ProjectId,
  RenderTarget,
  ResolvedAsset,
  RuntimeEvent,
  SourceId,
  TargetApplyReceipt,
  TargetCapabilities,
  TargetStatus,
} from "@strangecyan/vignette-core";
import { clamp } from "ramda";

import { bootstrapObsState } from "./bootstrap.js";
import { resolveObsCodecs, type ObsCodecMap, type ObsSourceCodec } from "./codecs/index.js";
import { ObsPreflightError, ObsTargetDisposedError } from "./errors.js";
import { subscribeToObsEvents } from "./events.js";
import { executeObsPlan } from "./executor.js";
import { managedSceneName, managedSourceName } from "./naming.js";
import type { ObservedObsState } from "./observed-state.js";
import { planObsUpdate } from "./planner.js";
import { ObsStatusStore } from "./status-store.js";
import type { ObsTransport } from "./transport.js";

/** Backoff, jitter, and temporary-not-ready retry limits. */
export interface ObsRetryOptions {
  readonly initialDelayMs?: number;
  readonly maximumDelayMs?: number;
  readonly jitterRatio?: number;
  readonly maximumNotReadyAttempts?: number;
}

/** Clock, randomness, and timer seam used by the convergence scheduler. */
export interface ObsSchedulerRuntime {
  readonly now: () => number;
  readonly random: () => number;
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

export interface ObsConvergenceSchedulerOptions {
  readonly id: string;
  readonly url: string;
  readonly password?: string;
  readonly projectId: ProjectId;
  readonly assetResolver: AssetResolver;
  readonly retry?: ObsRetryOptions;
  /** Source codecs contributed by extension packages (built-ins are always registered). */
  readonly extensions?: readonly ObsSourceCodec[];
  readonly onError?: (error: Error) => void;
  readonly transport: ObsTransport;
  readonly runtime?: ObsSchedulerRuntime;
}

interface SettlementWaiter {
  readonly revision: number;
  readonly resolve: (receipt: TargetApplyReceipt) => void;
  readonly reject: (error: Error) => void;
}

const OBS_TRANSFORM_CAPABILITIES: readonly Capability[] = [
  "scene:nested",
  "transform:crop",
  "transform:rotation",
];

const SYSTEM_RUNTIME: ObsSchedulerRuntime = {
  now: Date.now,
  random: Math.random,
  setTimeout(callback, delayMs) {
    return setTimeout(callback, delayMs);
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/**
 * Revisioned mailbox-of-one state machine. It owns asynchronous convergence;
 * React and the pure planner remain unaware of sockets, retries, and epochs.
 */
export class ObsConvergenceScheduler implements RenderTarget {
  readonly id: string;
  readonly kind = "obs" as const;
  readonly capabilities: TargetCapabilities;

  readonly #options: ObsConvergenceSchedulerOptions;
  readonly #codecs: ObsCodecMap;
  readonly #runtime: ObsSchedulerRuntime;
  readonly #status: ObsStatusStore;
  readonly #waiters = new Set<SettlementWaiter>();
  readonly #refreshedSources = new Set<SourceId>();
  readonly #unsubscribeEvents: () => void;
  #desired: CompiledSnapshot | undefined;
  #pending: CompiledSnapshot | undefined;
  #observed: ObservedObsState | undefined;
  #settledRevision = -1;
  #inFlightRevision: number | undefined;
  #epoch = 0;
  #connected = false;
  #draining = false;
  #scheduled = false;
  #paused = false;
  #disposed = false;
  #terminal = false;
  #failedRevision = -1;
  #failedError: Error | undefined;
  #retryAttempt = 0;
  #notReadyAttempt = 0;
  #retryTimer: unknown;

  constructor(options: ObsConvergenceSchedulerOptions) {
    this.#options = options;
    this.#codecs = resolveObsCodecs(options.extensions);
    this.#runtime = options.runtime ?? SYSTEM_RUNTIME;
    this.id = options.id;
    this.capabilities = {
      targetId: this.id,
      targetKind: "obs",
      capabilities: [...this.#codecs.keys(), ...OBS_TRANSFORM_CAPABILITIES].sort(),
    };
    this.#status = new ObsStatusStore(this.id);
    this.#unsubscribeEvents = subscribeToObsEvents(options.transport, {
      onCollectionChanging: () => {
        this.handleCollectionChanging();
      },
      onCollectionChanged: () => {
        this.handleCollectionChanged();
      },
      onConnectionClosed: (error) => {
        this.handleConnectionClosed(error);
      },
      onRemoteStateChanged: () => {
        this.handleRemoteStateChanged();
      },
    });
  }

  publish(snapshot: CompiledSnapshot): void {
    this.assertActive();
    if (snapshot.revision < this.desiredRevision) return;
    this.#desired = snapshot;
    this.#pending = snapshot;
    if (snapshot.revision > this.#failedRevision) this.#failedError = undefined;
    this.setStatus(this.#paused ? "paused" : "synchronising");
    this.scheduleDrain();
  }

  whenSettled(revision: number): Promise<TargetApplyReceipt> {
    if (this.#disposed) return Promise.reject(new ObsTargetDisposedError(this.id));
    if (this.#terminal) return Promise.reject(new Error(`OBS target '${this.id}' has failed.`));
    if (this.#settledRevision >= revision) return Promise.resolve(this.receipt(revision));
    if (revision <= this.#failedRevision && this.#failedError !== undefined) {
      return Promise.reject(this.#failedError);
    }
    return new Promise((resolve, reject) => this.#waiters.add({ revision, resolve, reject }));
  }

  getStatus(): TargetStatus {
    return this.#status.getSnapshot();
  }

  subscribe(listener: () => void): () => void {
    return this.#status.subscribe(listener);
  }

  async event(event: RuntimeEvent): Promise<void> {
    this.assertActive();
    await this.ensureObserved();
    await this.#options.transport.call("SetCurrentProgramScene", {
      sceneName: managedSceneName(this.#options.projectId, event.sceneId),
    });
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#desired = undefined;
    this.#pending = undefined;
    if (this.#retryTimer !== undefined) this.#runtime.clearTimeout(this.#retryTimer);
    this.#unsubscribeEvents();
    this.rejectWaiters(new ObsTargetDisposedError(this.id));
    if (this.#connected) {
      try {
        await this.#options.transport.disconnect();
      } catch {
        // Disposal remains terminal even when the socket has already gone away.
      }
    }
    this.#connected = false;
    this.#inFlightRevision = undefined;
    this.setStatus("disposed");
    this.#status.clear();
  }

  private scheduleDrain(): void {
    if (this.#scheduled || this.#draining || this.#paused || this.#terminal || this.#disposed)
      return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.#draining || this.#paused || this.#terminal || this.#disposed) return;
    this.#draining = true;
    try {
      for (;;) {
        const snapshot = this.takePending();
        if (snapshot === undefined) return;
        this.#inFlightRevision = snapshot.revision;
        this.setStatus("synchronising");
        try {
          await this.ensureObserved();
          if (this.shouldStop()) return;
          const observed = this.#observed;
          if (observed === undefined) throw new Error("OBS observation was invalidated.");
          const resolvedAssets = await this.resolveAssets(snapshot);
          const result = planObsUpdate({
            desired: snapshot,
            observed,
            resolvedAssets,
            codecs: this.#codecs,
          });
          if (!result.ok) {
            throw new ObsPreflightError(result.diagnostics.map((item) => item.message).join(" "));
          }
          if (result.plan.operations.length === 0) {
            if (snapshot.revision === this.desiredRevision) {
              await this.refreshSources(snapshot);
              if (snapshot.revision === this.desiredRevision) {
                this.markSettled(snapshot.revision);
              }
            }
            continue;
          }

          const executionEpoch = this.#epoch;
          const execution = await executeObsPlan(this.#options.transport, result.plan, {
            projectId: this.#options.projectId,
            isCurrentRevision: (revision) => revision === this.desiredRevision,
            isExecutionValid: () =>
              !this.#disposed && !this.#paused && this.#connected && executionEpoch === this.#epoch,
          });
          this.#observed = undefined;
          if (execution.interrupted) {
            this.requeueDesired();
            return;
          }
          if (snapshot.revision === this.desiredRevision) {
            await this.refreshSources(snapshot);
          }
          this.requeueIfCurrent(snapshot);
        } catch (cause) {
          const error = toError(cause);
          this.#observed = undefined;
          this.#options.onError?.(error);
          if (error instanceof ObsPreflightError) {
            this.#failedRevision = Math.max(this.#failedRevision, snapshot.revision);
            this.#failedError = error;
            this.setStatus("error", error.message);
            this.rejectWaitersThrough(error, snapshot.revision);
            if (snapshot.revision !== this.desiredRevision) this.requeueDesired();
            return;
          }
          this.requeueIfCurrent(snapshot);
          if (readErrorCode(error) === 207 && this.retryNotReady()) return;
          await this.resetConnectionAfterFailure();
          this.setStatus("disconnected", "Connection lost; retrying from a fresh observation.");
          this.scheduleRetry();
          return;
        } finally {
          this.#inFlightRevision = undefined;
        }
      }
    } finally {
      this.#draining = false;
      if (this.#pending !== undefined) this.scheduleDrain();
    }
  }

  private async ensureObserved(): Promise<void> {
    if (!this.#connected) {
      this.setStatus("connecting");
      await this.#options.transport.connect({
        url: this.#options.url,
        ...(this.#options.password === undefined ? {} : { password: this.#options.password }),
        rpcVersion: 1,
      });
      this.#connected = true;
      this.#retryAttempt = 0;
      this.#epoch += 1;
      this.#refreshedSources.clear();
    }
    if (this.#observed === undefined) {
      this.setStatus("bootstrapping");
      this.#observed = await bootstrapObsState(
        this.#options.transport,
        this.#options.projectId,
        this.#epoch,
      );
    }
  }

  private async resolveAssets(snapshot: CompiledSnapshot): Promise<ReadonlyMap<SourceId, string>> {
    const resolved = new Map<SourceId, string>();
    await Promise.all(
      snapshot.sources.map(async ({ id, asset }) => {
        if (asset === undefined) return;
        let value: ResolvedAsset;
        try {
          value = await this.#options.assetResolver.resolve(asset, {
            targetId: this.id,
            targetKind: "obs",
          });
        } catch (cause) {
          throw new ObsPreflightError(
            `OBS asset '${asset.name}' could not be resolved: ${toError(cause).message}`,
          );
        }
        if (value.kind !== "file") {
          throw new ObsPreflightError(`OBS asset '${asset.name}' must resolve to a file.`);
        }
        resolved.set(id, value.path);
      }),
    );
    return resolved;
  }

  /** Presses each codec's refresh property button once per connection after first settle. */
  private async refreshSources(snapshot: CompiledSnapshot): Promise<void> {
    const referencedSources = new Set<SourceId>();
    for (const scene of snapshot.scenes) {
      for (const item of scene.items) {
        if (item.content.kind === "source") referencedSources.add(item.content.sourceId);
      }
    }

    for (const source of snapshot.sources) {
      const refreshProperty = this.#codecs.get(source.definition.kind)?.refreshProperty;
      if (
        refreshProperty === undefined ||
        !referencedSources.has(source.id) ||
        this.#refreshedSources.has(source.id)
      ) {
        continue;
      }
      await this.#options.transport.call("PressInputPropertiesButton", {
        inputName: managedSourceName(this.#options.projectId, source.id),
        propertyName: refreshProperty,
      });
      this.#refreshedSources.add(source.id);
    }
  }

  private retryNotReady(): boolean {
    const maximumAttempts = this.#options.retry?.maximumNotReadyAttempts ?? 5;
    if (this.#notReadyAttempt >= maximumAttempts) {
      this.#notReadyAttempt = 0;
      return false;
    }
    this.#notReadyAttempt += 1;
    this.setStatus("paused", "OBS is temporarily not ready; retrying.");
    this.scheduleRetry();
    return true;
  }

  private scheduleRetry(): void {
    if (this.#retryTimer !== undefined || this.#disposed || this.#terminal) return;
    const initial = Math.max(1, this.#options.retry?.initialDelayMs ?? 250);
    const maximum = Math.max(initial, this.#options.retry?.maximumDelayMs ?? 10_000);
    const jitterRatio = clamp(0, 1, this.#options.retry?.jitterRatio ?? 0.2);
    const base = Math.min(maximum, initial * 2 ** this.#retryAttempt);
    const jitter = 1 + (this.#runtime.random() * 2 - 1) * jitterRatio;
    const delay = Math.max(0, Math.round(base * jitter));
    this.#retryAttempt += 1;
    this.#retryTimer = this.#runtime.setTimeout(() => {
      this.#retryTimer = undefined;
      this.scheduleDrain();
    }, delay);
  }

  private async resetConnectionAfterFailure(): Promise<void> {
    if (!this.#connected) return;
    this.#connected = false;
    try {
      await this.#options.transport.disconnect();
    } catch {
      // The next attempt always starts with a fresh authoritative bootstrap.
    }
  }

  private handleCollectionChanging(): void {
    if (this.#disposed) return;
    this.#paused = true;
    this.#observed = undefined;
    this.requeueDesired();
    this.setStatus("paused", "OBS scene collection is changing.");
  }

  private handleCollectionChanged(): void {
    if (this.#disposed) return;
    this.#paused = false;
    this.#observed = undefined;
    this.#epoch += 1;
    this.#refreshedSources.clear();
    this.requeueDesired();
    this.setStatus("bootstrapping");
    this.scheduleDrain();
  }

  private handleRemoteStateChanged(): void {
    if (this.#disposed || this.#terminal) return;
    this.#observed = undefined;
    this.requeueDesired();
    this.scheduleDrain();
  }

  private handleConnectionClosed(error: unknown): void {
    if (this.#disposed) return;
    this.#connected = false;
    this.#observed = undefined;
    this.requeueDesired();
    const code = readErrorCode(error);
    if (code === 4011) {
      const terminal = new Error("OBS invalidated this websocket session; reconnect is disabled.");
      this.#terminal = true;
      this.setStatus("error", terminal.message);
      this.rejectWaiters(terminal);
      return;
    }
    this.setStatus("disconnected", "Connection lost; retrying from a fresh observation.");
    this.scheduleRetry();
  }

  private markSettled(revision: number): void {
    this.#settledRevision = revision;
    this.#notReadyAttempt = 0;
    this.setStatus("settled");
    for (const waiter of this.#waiters) {
      if (waiter.revision > revision) continue;
      waiter.resolve(this.receipt(waiter.revision));
      this.#waiters.delete(waiter);
    }
  }

  private receipt(requestedRevision: number): TargetApplyReceipt {
    return {
      targetId: this.id,
      requestedRevision,
      settledRevision: this.#settledRevision,
      settledAt: this.#runtime.now(),
    };
  }

  private rejectWaiters(error: Error): void {
    for (const waiter of this.#waiters) waiter.reject(error);
    this.#waiters.clear();
  }

  private rejectWaitersThrough(error: Error, revision: number): void {
    for (const waiter of this.#waiters) {
      if (waiter.revision > revision) continue;
      waiter.reject(error);
      this.#waiters.delete(waiter);
    }
  }

  private setStatus(phase: TargetStatus["phase"], message?: string): void {
    this.#status.set({
      targetId: this.id,
      phase,
      ...(this.desiredRevision < 0 ? {} : { desiredRevision: this.desiredRevision }),
      ...(this.#settledRevision < 0 ? {} : { settledRevision: this.#settledRevision }),
      ...(this.#inFlightRevision === undefined ? {} : { inFlightRevision: this.#inFlightRevision }),
      ...(this.#epoch === 0 ? {} : { observationEpoch: this.#epoch }),
      ...(message === undefined ? {} : { message }),
    });
  }

  private takePending(): CompiledSnapshot | undefined {
    const snapshot = this.#pending;
    this.#pending = undefined;
    return snapshot;
  }

  private requeueDesired(): void {
    if (this.#desired !== undefined) this.#pending = this.#desired;
  }

  private requeueIfCurrent(snapshot: CompiledSnapshot): void {
    if (this.#pending === undefined && snapshot.revision === this.desiredRevision) {
      this.#pending = snapshot;
    }
  }

  private shouldStop(): boolean {
    return this.#disposed || this.#paused || !this.#connected;
  }

  private assertActive(): void {
    if (this.#disposed) throw new ObsTargetDisposedError(this.id);
    if (this.#terminal) throw new Error(`OBS target '${this.id}' is in a terminal error state.`);
  }

  private get desiredRevision(): number {
    return this.#desired?.revision ?? -1;
  }
}

function readErrorCode(error: unknown): number | undefined {
  let current: unknown = error;
  const visited = new Set<unknown>();
  while (typeof current === "object" && current !== null && !visited.has(current)) {
    visited.add(current);
    const record = current as { readonly code?: unknown; readonly cause?: unknown };
    if (typeof record.code === "number") return record.code;
    current = record.cause;
  }
  return undefined;
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error("OBS target failed.", { cause });
}
