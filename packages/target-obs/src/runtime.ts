import type {
  AssetManifest,
  CompiledSnapshot,
  ProjectId,
  RuntimeEvent,
  SnapshotRuntime,
  TargetApplyReceipt,
  TargetStatus,
} from "@strangecyan/vignette-core";

import { ObsAssetStore, type ObsAssetStoreOptions } from "./asset-store.js";
import type { ObsSourceCodec } from "./codecs/index.js";
import { createObsScheduler } from "./create-obs-target.js";
import { ObsWebSocketTransport } from "./obs-websocket-transport.js";
import type { ObsConvergenceScheduler, ObsRetryOptions, ObsSchedulerRuntime } from "./scheduler.js";
import type { ObsTransport } from "./transport.js";

/** Asset, connection, retry, extension, and test seams for an OBS runtime. */
export interface OBSRuntimeOptions extends ObsAssetStoreOptions {
  readonly id?: string;
  readonly url?: string;
  readonly password?: string;
  readonly projectId: ProjectId;
  readonly retry?: ObsRetryOptions;
  /** Source codecs contributed by extension packages (built-ins are always registered). */
  readonly extensions?: readonly ObsSourceCodec[];
  readonly onError?: (error: Error) => void;
  readonly transport?: ObsTransport;
  readonly schedulerRuntime?: ObsSchedulerRuntime;
}

/** Applies runtime messages to OBS through dependency-aware convergence planning. */
export class OBSRuntime implements SnapshotRuntime {
  readonly #assets: ObsAssetStore;
  readonly #scheduler: ObsConvergenceScheduler;
  #setup = false;

  constructor(options: OBSRuntimeOptions) {
    this.#assets = new ObsAssetStore(options);
    this.#scheduler = createObsScheduler(
      { ...options, assetResolver: this.#assets },
      options.transport ?? new ObsWebSocketTransport(),
      options.schedulerRuntime,
    );
  }

  async setup(manifest: AssetManifest): Promise<void> {
    await this.#assets.setup(manifest);
    this.#setup = true;
  }

  update(snapshot: CompiledSnapshot): void {
    this.assertSetup();
    this.#scheduler.publish(snapshot);
  }

  event(event: RuntimeEvent): Promise<void> {
    this.assertSetup();
    return this.#scheduler.event(event);
  }

  whenSettled(revision: number): Promise<TargetApplyReceipt> {
    return this.#scheduler.whenSettled(revision);
  }

  getStatus(): TargetStatus {
    return this.#scheduler.getStatus();
  }

  async dispose(): Promise<void> {
    await this.#scheduler.dispose();
    await this.#assets.dispose();
    this.#setup = false;
  }

  private assertSetup(): void {
    if (!this.#setup) throw new Error("OBS runtime must receive an asset manifest before updates.");
  }
}
