import { describeMissingExtensions, omitUndefined } from "@strangecyan/vignette-core";
import type {
  CompiledSnapshot,
  StreamEvent,
  StreamSetup,
  TargetRuntime,
  TargetApplyReceipt,
  TargetStatus,
} from "@strangecyan/vignette-core";

import { ObsAssetStore, type ObsAssetStoreOptions } from "./asset-store.js";
import type { ObsSourceCodec } from "./codecs/index.js";
import { createObsScheduler } from "./create-obs-target.js";
import { ObsWebSocketTransport } from "./obs-websocket-transport.js";
import type { ObsConvergenceScheduler, ObsRetryOptions, ObsSchedulerRuntime } from "./scheduler.js";
import type { ObsTransport } from "./transport.js";

/**
 * Asset, connection, retry, extension, and test seams for an OBS runtime.
 *
 * Root-relative snapshot URLs resolve against `baseUrl` (how this process reaches the composer,
 * used for asset downloads) and `browserSourceBaseUrl` (how OBS itself reaches the composer,
 * used for browser sources; defaults to `baseUrl`).
 */
export interface OBSRuntimeOptions extends ObsAssetStoreOptions {
  readonly id?: string | undefined;
  readonly url?: string | undefined;
  readonly password?: string | undefined;
  readonly projectId: string;
  /** Base for root-relative URLs OBS loads itself (browser sources). Defaults to `baseUrl`. */
  readonly browserSourceBaseUrl?: string | undefined;
  readonly retry?: ObsRetryOptions | undefined;
  /** Source codecs contributed by extension packages (built-ins are always registered). */
  readonly extensions?: readonly ObsSourceCodec[] | undefined;
  readonly onError?: ((error: Error) => void) | undefined;
  readonly transport?: ObsTransport | undefined;
  readonly schedulerRuntime?: ObsSchedulerRuntime | undefined;
}

/**
 * Applies stream messages to OBS through dependency-aware convergence planning.
 *
 * Setup is the safety gate: a stream for a different project, or one that advertises an extension
 * source kind without a registered codec, puts the runtime into its `error` phase without touching
 * OBS. Updates and events are ignored until a setup the runtime can satisfy.
 */
export class OBSRuntime implements TargetRuntime {
  private readonly options: OBSRuntimeOptions;
  private readonly assets: ObsAssetStore;
  private readonly scheduler: ObsConvergenceScheduler;
  private setupFailure: Error | undefined;
  private hasSetup = false;

  constructor(options: OBSRuntimeOptions) {
    this.options = options;
    this.assets = new ObsAssetStore(options);
    this.scheduler = createObsScheduler(
      {
        ...options,
        assetResolver: this.assets,
        ...omitUndefined({ browserSourceBaseUrl: options.browserSourceBaseUrl ?? options.baseUrl }),
      },
      options.transport ?? new ObsWebSocketTransport(),
      options.schedulerRuntime,
    );
  }

  /** Refuse foreign projects and unsupported extensions before downloading any asset. */
  async setup(setup: StreamSetup): Promise<void> {
    const failure = this.checkSetup(setup);
    if (failure !== undefined) {
      this.setupFailure = new Error(failure);
      this.options.onError?.(this.setupFailure);
      return;
    }
    await this.assets.setup(setup.manifest);
    this.hasSetup = true;
    this.setupFailure = undefined;
  }

  update(snapshot: CompiledSnapshot): void {
    if (this.setupFailure !== undefined) return;
    this.assertSetup();
    this.scheduler.publish(snapshot);
  }

  event(event: StreamEvent): Promise<void> {
    if (this.setupFailure !== undefined) return Promise.resolve();
    this.assertSetup();
    return this.scheduler.event(event);
  }

  whenSettled(revision: number): Promise<TargetApplyReceipt> {
    if (this.setupFailure !== undefined) return Promise.reject(this.setupFailure);
    return this.scheduler.whenSettled(revision);
  }

  getStatus(): TargetStatus {
    if (this.setupFailure === undefined) return this.scheduler.getStatus();
    return { targetId: this.scheduler.id, phase: "error", message: this.setupFailure.message };
  }

  async dispose(): Promise<void> {
    await this.scheduler.dispose();
    await this.assets.dispose();
    this.hasSetup = false;
  }

  private checkSetup(setup: StreamSetup): string | undefined {
    if (setup.projectId !== this.options.projectId) {
      return `Stream is for project '${setup.projectId}' but this OBS runtime manages project '${this.options.projectId}' (projectId / --project); refusing to manage OBS.`;
    }
    return describeMissingExtensions(
      setup.extensions,
      new Set(this.scheduler.capabilities.capabilities),
      "obs",
    );
  }

  private assertSetup(): void {
    if (!this.hasSetup)
      throw new Error("OBS runtime must receive an asset manifest before updates.");
  }
}
