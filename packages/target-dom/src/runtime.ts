import {
  omitUndefined,
  type AssetManifest,
  type CompiledSnapshot,
  type RuntimeEvent,
  type SnapshotRuntime,
  type TargetApplyReceipt,
  type TargetStatus,
} from "@strangecyan/vignette-core";

import { DomAssetStore, type DomAssetStoreOptions } from "./asset-store.js";
import { DomTarget } from "./dom-target.js";
import type { DomSourceRenderer } from "./elements/index.js";

/** Configuration for a transport-agnostic DOM snapshot runtime. */
export interface DOMRuntimeOptions extends DomAssetStoreOptions {
  readonly id?: string;
  readonly container: HTMLElement;
  readonly sceneId: string;
  /** Source renderers contributed by extension packages (built-ins are always registered). */
  readonly extensions?: readonly DomSourceRenderer[];
  readonly onError?: (error: Error) => void;
}

/** Applies setup, update, and event messages to a browser DOM target. */
export class DOMRuntime implements SnapshotRuntime {
  readonly #assets: DomAssetStore;
  readonly #target: DomTarget;
  readonly #serverSnapshot: TargetStatus;
  #setup = false;

  constructor(options: DOMRuntimeOptions) {
    this.#assets = new DomAssetStore(options);
    this.#target = new DomTarget(
      omitUndefined({
        id: options.id,
        container: options.container,
        sceneId: options.sceneId,
        assetResolver: this.#assets,
        extensions: options.extensions,
        onError: options.onError,
      }),
    );
    this.#serverSnapshot = this.#target.getStatus();
  }

  /** Stable method references compatible with React's useSyncExternalStore contract. */
  readonly subscribe = (listener: () => void): (() => void) => this.#target.subscribe(listener);

  readonly getSnapshot = (): TargetStatus => this.#target.getStatus();

  readonly getServerSnapshot = (): TargetStatus => this.#serverSnapshot;

  async setup(manifest: AssetManifest): Promise<void> {
    await this.#assets.setup(manifest);
    this.#setup = true;
  }

  update(snapshot: CompiledSnapshot): void {
    this.assertSetup();
    this.#target.publish(snapshot);
  }

  event(event: RuntimeEvent): Promise<void> {
    this.assertSetup();
    return this.#target.setScene(event.sceneId);
  }

  whenSettled(revision: number): Promise<TargetApplyReceipt> {
    return this.#target.whenSettled(revision);
  }

  getStatus(): TargetStatus {
    return this.getSnapshot();
  }

  async dispose(): Promise<void> {
    await this.#target.dispose();
    this.#assets.dispose();
    this.#setup = false;
  }

  private assertSetup(): void {
    if (!this.#setup) throw new Error("DOM runtime must receive an asset manifest before updates.");
  }
}
