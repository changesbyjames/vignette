import type {
  AssetResolver,
  Capability,
  CompiledScene,
  CompiledSnapshot,
  RenderTarget,
  SourceId,
  TargetApplyReceipt,
  TargetCapabilities,
  TargetStatus,
} from "@strangecyan/vignette-core";

import { DomAssetRegistry } from "./media-registry.js";
import {
  resolveDomRenderers,
  type DomRendererMap,
  type DomSourceRenderer,
} from "./elements/index.js";
import { DomScenePatcher } from "./patch.js";
import { DomStage } from "./stage.js";

/** Configuration for rendering one compiled scene into a DOM container. */
export interface DomTargetOptions {
  readonly id?: string;
  readonly container: HTMLElement;
  readonly sceneId: string;
  readonly assetResolver: AssetResolver;
  /** Source renderers contributed by extension packages (built-ins are always registered). */
  readonly extensions?: readonly DomSourceRenderer[];
  readonly onError?: (error: Error) => void;
}

interface SettlementWaiter {
  readonly revision: number;
  readonly resolve: (receipt: TargetApplyReceipt) => void;
  readonly reject: (error: Error) => void;
}

interface PreparedSnapshot {
  readonly snapshot: CompiledSnapshot;
  readonly scene: CompiledScene;
  readonly resolvedUrls: ReadonlyMap<string, string>;
}

interface PendingApply {
  readonly snapshot: CompiledSnapshot;
  readonly sceneId: string;
  readonly generation: number;
}

interface ApplyWaiter {
  readonly generation: number;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

const DOM_TRANSFORM_CAPABILITIES: readonly Capability[] = [
  "scene:nested",
  "transform:crop",
  "transform:opacity",
  "transform:rotation",
];

/** Asynchronous DOM render target with latest-wins snapshot convergence. */
export class DomTarget implements RenderTarget {
  readonly id: string;
  readonly kind = "dom" as const;
  readonly capabilities: TargetCapabilities;

  readonly #options: DomTargetOptions;
  readonly #renderers: DomRendererMap;
  readonly #prepared = new Map<DomSourceRenderer, Promise<void>>();
  readonly #stage: DomStage;
  readonly #patcher: DomScenePatcher;
  readonly #assets: DomAssetRegistry;
  readonly #listeners = new Set<() => void>();
  readonly #waiters = new Set<SettlementWaiter>();
  readonly #applyWaiters = new Set<ApplyWaiter>();
  #status: TargetStatus;
  #pending: PendingApply | undefined;
  #latestSnapshot: CompiledSnapshot | undefined;
  #sceneId: string;
  #desiredGeneration = 0;
  #settledGeneration = 0;
  #desiredRevision = -1;
  #settledRevision = -1;
  #draining = false;
  #scheduled = false;
  #disposed = false;

  constructor(options: DomTargetOptions) {
    this.#options = options;
    this.#renderers = resolveDomRenderers(options.extensions);
    this.#sceneId = options.sceneId;
    this.id = options.id ?? "dom";
    this.capabilities = {
      targetId: this.id,
      targetKind: "dom",
      capabilities: [...this.#renderers.keys(), ...DOM_TRANSFORM_CAPABILITIES].sort(),
    };
    this.#stage = new DomStage(options.container);
    this.#patcher = new DomScenePatcher(this.#stage.stage, this.#renderers);
    this.#assets = new DomAssetRegistry(options.assetResolver, this.id);
    this.#status = { targetId: this.id, phase: "disconnected" };
  }

  publish(snapshot: CompiledSnapshot): void {
    this.assertActive();
    if (snapshot.revision < this.#desiredRevision) return;
    this.#latestSnapshot = snapshot;
    this.#desiredRevision = snapshot.revision;
    this.enqueue(snapshot, this.#sceneId);
  }

  setScene(sceneId: string): Promise<void> {
    this.assertActive();
    if (sceneId === this.#sceneId && this.#pending === undefined) return Promise.resolve();
    const snapshot = this.#latestSnapshot;
    if (snapshot !== undefined && !snapshot.scenes.some((candidate) => candidate.id === sceneId)) {
      return Promise.reject(
        new Error(`Scene '${sceneId}' is not present in revision ${String(snapshot.revision)}.`),
      );
    }
    this.#sceneId = sceneId;
    if (snapshot === undefined) return Promise.resolve();
    return this.waitForApply(this.enqueue(snapshot, sceneId));
  }

  whenSettled(revision: number): Promise<TargetApplyReceipt> {
    if (this.#disposed) return Promise.reject(new Error(`DOM target '${this.id}' is disposed.`));
    if (this.#settledRevision >= revision) return Promise.resolve(this.receipt(revision));
    return new Promise<TargetApplyReceipt>((resolve, reject) => {
      this.#waiters.add({ revision, resolve, reject });
    });
  }

  getStatus(): TargetStatus {
    return this.#status;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  dispose(): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    this.#disposed = true;
    this.#pending = undefined;
    this.#latestSnapshot = undefined;
    const error = new Error(`DOM target '${this.id}' was disposed.`);
    for (const waiter of this.#waiters) waiter.reject(error);
    this.#waiters.clear();
    for (const waiter of this.#applyWaiters) waiter.reject(error);
    this.#applyWaiters.clear();
    this.#assets.clear();
    this.#patcher.dispose();
    this.#stage.dispose();
    this.setStatus("disposed");
    this.#listeners.clear();
    return Promise.resolve();
  }

  private scheduleDrain(): void {
    if (this.#scheduled || this.#draining) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.#draining || this.#disposed) return;
    this.#draining = true;
    try {
      while (this.#pending !== undefined) {
        const pending = this.#pending;
        this.#pending = undefined;
        try {
          const prepared = await this.prepare(pending.snapshot, pending.sceneId);
          if (this.isDisposed()) return;
          if (pending.generation < this.#desiredGeneration) continue;
          this.#stage.update(pending.snapshot);
          this.#patcher.patch(prepared.snapshot, prepared.scene, prepared.resolvedUrls);
          this.#settledRevision = pending.snapshot.revision;
          this.#settledGeneration = pending.generation;
          this.setStatus("settled");
          this.resolveWaiters();
          this.resolveApplyWaiters();
        } catch (cause) {
          const error = cause instanceof Error ? cause : new Error("DOM target failed.", { cause });
          this.setStatus("error", error.message);
          this.#options.onError?.(error);
          this.rejectWaiters(pending.snapshot.revision, error);
          this.rejectApplyWaiters(pending.generation, error);
        }
      }
    } finally {
      this.#draining = false;
      if (this.#pending !== undefined) this.scheduleDrain();
    }
  }

  private async prepare(snapshot: CompiledSnapshot, sceneId: string): Promise<PreparedSnapshot> {
    const scene = snapshot.scenes.find((candidate) => candidate.id === sceneId);
    if (scene === undefined) {
      throw new Error(
        `Scene '${sceneId}' is not present in revision ${String(snapshot.revision)}.`,
      );
    }

    const sources = new Map(snapshot.sources.map((source) => [source.id, source]));
    const sourceIds = collectSceneSourceIds(snapshot, scene);
    const document = this.#options.container.ownerDocument;
    const resolved = new Map<string, string>();
    await Promise.all(
      [...sourceIds].map(async (id) => {
        const source = sources.get(id);
        if (source === undefined) throw new Error(`Compiled source '${id}' is missing.`);
        const renderer = this.#renderers.get(source.definition.kind);
        if (renderer === undefined) {
          throw new Error(
            `No DOM renderer is registered for source kind '${source.definition.kind}'. Pass its extension to the DOM runtime.`,
          );
        }
        if (renderer.prepare !== undefined) {
          let preparation = this.#prepared.get(renderer);
          if (preparation === undefined) {
            preparation = renderer.prepare(document).catch((cause: unknown) => {
              this.#prepared.delete(renderer);
              throw cause;
            });
            this.#prepared.set(renderer, preparation);
          }
          await preparation;
        }
        if (source.asset !== undefined) {
          resolved.set(id, await this.#assets.resolve(source.asset));
        }
      }),
    );
    return { snapshot, scene, resolvedUrls: resolved };
  }

  private resolveWaiters(): void {
    for (const waiter of this.#waiters) {
      if (waiter.revision > this.#settledRevision) continue;
      waiter.resolve(this.receipt(waiter.revision));
      this.#waiters.delete(waiter);
    }
  }

  private rejectWaiters(upToRevision: number, error: Error): void {
    for (const waiter of this.#waiters) {
      if (waiter.revision > upToRevision) continue;
      waiter.reject(error);
      this.#waiters.delete(waiter);
    }
  }

  private enqueue(snapshot: CompiledSnapshot, sceneId: string): number {
    const generation = ++this.#desiredGeneration;
    this.#pending = { snapshot, sceneId, generation };
    this.setStatus("synchronising");
    this.scheduleDrain();
    return generation;
  }

  private waitForApply(generation: number): Promise<void> {
    if (this.#settledGeneration >= generation) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.#applyWaiters.add({ generation, resolve, reject });
    });
  }

  private resolveApplyWaiters(): void {
    for (const waiter of this.#applyWaiters) {
      if (waiter.generation > this.#settledGeneration) continue;
      waiter.resolve();
      this.#applyWaiters.delete(waiter);
    }
  }

  private rejectApplyWaiters(upToGeneration: number, error: Error): void {
    for (const waiter of this.#applyWaiters) {
      if (waiter.generation > upToGeneration) continue;
      waiter.reject(error);
      this.#applyWaiters.delete(waiter);
    }
  }

  private receipt(requestedRevision: number): TargetApplyReceipt {
    return {
      targetId: this.id,
      requestedRevision,
      settledRevision: this.#settledRevision,
      settledAt: Date.now(),
    };
  }

  private setStatus(phase: TargetStatus["phase"], message?: string): void {
    this.#status = {
      targetId: this.id,
      phase,
      ...(this.#desiredRevision < 0 ? {} : { desiredRevision: this.#desiredRevision }),
      ...(this.#settledRevision < 0 ? {} : { settledRevision: this.#settledRevision }),
      ...(message === undefined ? {} : { message }),
    };
    for (const listener of this.#listeners) listener();
  }

  private assertActive(): void {
    if (this.#disposed) throw new Error(`DOM target '${this.id}' is disposed.`);
  }

  private isDisposed(): boolean {
    return this.#disposed;
  }
}

function collectSceneSourceIds(
  snapshot: CompiledSnapshot,
  root: CompiledScene,
): ReadonlySet<SourceId> {
  const result = new Set<SourceId>();
  const scenes = new Map(snapshot.scenes.map((scene) => [scene.id, scene]));
  const visited = new Set<string>();

  const visit = (scene: CompiledScene) => {
    if (visited.has(scene.id)) return;
    visited.add(scene.id);
    for (const item of scene.items) {
      if (item.content.kind === "source") result.add(item.content.sourceId);
      else {
        const nested = scenes.get(item.content.sceneId);
        if (nested !== undefined) visit(nested);
      }
    }
  };

  visit(root);
  return result;
}
