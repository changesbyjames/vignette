import type {
  CompiledSnapshot,
  RenderTarget,
  TargetApplyReceipt,
  TargetCapabilities,
  TargetKind,
  TargetStatus,
} from "@strangecyan/vignette-core";

/** In-memory render target that records every published snapshot. */
export class FakeRenderTarget implements RenderTarget {
  readonly id: string;
  readonly kind: TargetKind;
  readonly capabilities: TargetCapabilities;
  readonly published: CompiledSnapshot[] = [];
  #listeners = new Set<() => void>();
  #disposed = false;
  publishError: Error | undefined;

  constructor(
    id: string,
    kind: TargetKind = "dom",
    capabilities: TargetCapabilities["capabilities"] = ALL_CAPABILITIES,
  ) {
    this.id = id;
    this.kind = kind;
    this.capabilities = {
      targetId: id,
      targetKind: kind,
      capabilities,
    };
  }

  publish(snapshot: CompiledSnapshot): void {
    if (this.#disposed) throw new Error(`Fake target '${this.id}' is disposed.`);
    if (this.publishError !== undefined) throw this.publishError;
    this.published.push(snapshot);
    for (const listener of this.#listeners) listener();
  }

  whenSettled(revision: number): Promise<TargetApplyReceipt> {
    const settledRevision = this.published.at(-1)?.revision ?? -1;
    if (settledRevision < revision) {
      return Promise.reject(
        new Error(`Fake target '${this.id}' has not settled revision ${String(revision)}.`),
      );
    }
    return Promise.resolve({
      targetId: this.id,
      requestedRevision: revision,
      settledRevision,
      settledAt: Date.now(),
    });
  }

  getStatus(): TargetStatus {
    const revision = this.published.at(-1)?.revision;
    return {
      targetId: this.id,
      phase: this.#disposed ? "disposed" : revision === undefined ? "disconnected" : "settled",
      ...(revision === undefined ? {} : { desiredRevision: revision, settledRevision: revision }),
    };
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): Promise<void> {
    this.#disposed = true;
    this.#listeners.clear();
    return Promise.resolve();
  }
}

const ALL_CAPABILITIES: TargetCapabilities["capabilities"] = [
  "source:image",
  "source:media-file",
  "source:browser",
  "source:color",
  "scene:nested",
  "transform:crop",
  "transform:opacity",
  "transform:rotation",
];
