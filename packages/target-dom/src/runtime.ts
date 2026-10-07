import {
  describeMissingExtensions,
  omitUndefined,
  type CompiledSnapshot,
  type StreamEvent,
  type StreamSetup,
  type TargetRuntime,
  type TargetApplyReceipt,
  type TargetStatus,
} from "@strangecyan/vignette-core";

import { DomAssetStore, type DomAssetStoreOptions } from "./asset-store.js";
import { DomTarget } from "./dom-target.js";
import type { DomSourceRenderer } from "./elements/index.js";

/** Configuration for a transport-agnostic DOM target runtime. */
export interface DOMRuntimeOptions extends DomAssetStoreOptions {
  readonly id?: string | undefined;
  readonly container: HTMLElement;
  readonly sceneId: string;
  /**
   * Base for root-relative snapshot and manifest URLs, such as `/__vignette/frame/...` and
   * `/assets/...`. May be relative to the container document. Defaults to the document's
   * `baseURI`; `useStage` defaults it to the stream's URL.
   */
  readonly baseUrl?: string | undefined;
  /** Source renderers contributed by extension packages (built-ins are always registered). */
  readonly extensions?: readonly DomSourceRenderer[] | undefined;
  readonly onError?: ((error: Error) => void) | undefined;
}

/**
 * Applies setup, update, and event messages to a browser DOM target.
 *
 * A setup that advertises an extension source kind without a registered renderer puts the runtime
 * into its `error` phase; updates and events are ignored until a setup the runtime can satisfy.
 */
export class DOMRuntime implements TargetRuntime {
  private readonly options: DOMRuntimeOptions;
  private readonly assets: DomAssetStore;
  private readonly target: DomTarget;
  private readonly serverSnapshot: TargetStatus;
  private readonly listeners = new Set<() => void>();
  private setupFailure: TargetStatus | undefined;
  private hasSetup = false;

  constructor(options: DOMRuntimeOptions) {
    this.options = options;
    const document = options.container.ownerDocument;
    const baseUrl = new URL(options.baseUrl ?? document.baseURI, document.baseURI).href;
    this.assets = new DomAssetStore(baseUrl, options);
    this.target = new DomTarget(
      omitUndefined({
        id: options.id,
        container: options.container,
        sceneId: options.sceneId,
        baseUrl,
        assetResolver: this.assets,
        extensions: options.extensions,
        onError: options.onError,
      }),
    );
    this.serverSnapshot = this.target.getStatus();
  }

  /** Stable method references compatible with React's useSyncExternalStore contract. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    const unsubscribe = this.target.subscribe(listener);
    return () => {
      this.listeners.delete(listener);
      unsubscribe();
    };
  };

  readonly getSnapshot = (): TargetStatus => this.setupFailure ?? this.target.getStatus();

  readonly getServerSnapshot = (): TargetStatus => this.serverSnapshot;

  /** Verify advertised extension kinds before downloading assets; a failure is observable status. */
  async setup(setup: StreamSetup): Promise<void> {
    const missing = describeMissingExtensions(
      setup.extensions,
      new Set(this.target.capabilities.capabilities),
      "dom",
    );
    if (missing !== undefined) {
      this.setupFailure = { targetId: this.target.id, phase: "error", message: missing };
      this.notify();
      this.options.onError?.(new Error(missing));
      return;
    }
    await this.assets.setup(setup.manifest);
    this.hasSetup = true;
    if (this.setupFailure !== undefined) {
      this.setupFailure = undefined;
      this.notify();
    }
  }

  update(snapshot: CompiledSnapshot): void {
    if (this.setupFailure !== undefined) return;
    this.assertSetup();
    this.target.publish(snapshot);
  }

  event(event: StreamEvent): Promise<void> {
    if (this.setupFailure !== undefined) return Promise.resolve();
    this.assertSetup();
    return this.target.setScene(event.sceneId);
  }

  whenSettled(revision: number): Promise<TargetApplyReceipt> {
    return this.target.whenSettled(revision);
  }

  getStatus(): TargetStatus {
    return this.getSnapshot();
  }

  async dispose(): Promise<void> {
    await this.target.dispose();
    this.assets.dispose();
    this.hasSetup = false;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private assertSetup(): void {
    if (!this.hasSetup)
      throw new Error("DOM runtime must receive an asset manifest before updates.");
  }
}
