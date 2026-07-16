import type { CompiledSnapshot } from "./snapshot.js";
export type Capability =
  | `source:${string}`
  | "scene:nested"
  | "transform:crop"
  | "transform:opacity"
  | "transform:rotation";

export type TargetKind = string;
export type UnsupportedPolicy = "error" | "warn-and-omit" | "use-fallback";

export interface TargetCapabilities {
  readonly targetId: string;
  readonly targetKind: TargetKind;
  readonly capabilities: readonly Capability[];
}

export type TargetPhase =
  | "disconnected"
  | "connecting"
  | "bootstrapping"
  | "synchronising"
  | "settled"
  | "paused"
  | "error"
  | "disposed";

export interface TargetStatus {
  readonly targetId: string;
  readonly phase: TargetPhase;
  readonly desiredRevision?: number;
  readonly settledRevision?: number;
  readonly inFlightRevision?: number;
  readonly observationEpoch?: number;
  readonly message?: string;
}

export interface TargetApplyReceipt {
  readonly targetId: string;
  readonly requestedRevision: number;
  readonly settledRevision: number;
  readonly settledAt: number;
}

export interface RenderTarget {
  readonly id: string;
  readonly kind: TargetKind;
  readonly capabilities: TargetCapabilities;
  publish(snapshot: CompiledSnapshot): void;
  whenSettled(revision: number): Promise<TargetApplyReceipt>;
  getStatus(): TargetStatus;
  subscribe(listener: () => void): () => void;
  dispose(): Promise<void>;
}

export function requiredCapabilities(snapshot: CompiledSnapshot): readonly Capability[] {
  const required = new Set<Capability>();
  for (const source of snapshot.sources) required.add(source.definition.kind);
  for (const scene of snapshot.scenes) {
    for (const item of scene.items) {
      if (item.content.kind === "scene") required.add("scene:nested");
      if (item.rotation !== 0) required.add("transform:rotation");
      if (item.opacity !== 1) required.add("transform:opacity");
      if (
        item.clip !== undefined ||
        (item.placement !== undefined &&
          Object.values(item.placement.sourceCrop).some((value) => value !== 0))
      ) {
        required.add("transform:crop");
      }
    }
  }
  return [...required].sort();
}
