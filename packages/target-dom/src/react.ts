import type { RuntimeMessage } from "@strangecyan/vignette-core";
import { omitUndefined } from "@strangecyan/vignette-core";
/**
 * React integration for mounting and observing a DOM compositor driven by runtime messages.
 *
 * @module
 */
import type { RuntimeMessageSource, TargetPhase, TargetStatus } from "@strangecyan/vignette-core";
import { equals } from "ramda";
import { useMemo, useRef, useSyncExternalStore, type RefCallback } from "react";

import { DOMRuntime, type DOMRuntimeOptions } from "./runtime.js";

/** DOM runtime options plus the scene and runtime-message transport to consume. */
export interface UseCompositorOptions extends Omit<DOMRuntimeOptions, "container" | "sceneId"> {
  readonly sceneId: string;
  /**
   * The transport delivering runtime messages, e.g. `sseRuntimeSource("/runtime")`. When
   * `baseUrl` is omitted, root-relative snapshot URLs resolve against the transport's `url`.
   */
  readonly transport: RuntimeMessageSource;
}

/** Browser compositor lifecycle, including pre-runtime setup phases. */
export type CompositorPhase =
  | "waiting-for-container"
  | "connecting"
  | "downloading-assets"
  | TargetPhase;

/** Stable React external-store snapshot for a mounted compositor. */
export interface CompositorSnapshot {
  readonly targetId: string;
  readonly sceneId: string;
  readonly phase: CompositorPhase;
  readonly revision: number;
  readonly desiredRevision?: number;
  readonly settledRevision?: number;
  readonly message?: string;
}

/** Ref callback that owns the lifetime of a DOM compositor container. */
export type CompositorRef = RefCallback<HTMLDivElement>;
/** Container ref and current compositor status returned by `useCompositor`. */
export type CompositorResult = readonly [ref: CompositorRef, snapshot: CompositorSnapshot];

/**
 * Owns a DOMRuntime for one container and subscribes to its cached external-store snapshot.
 */
export function useCompositor(options: UseCompositorOptions): CompositorResult {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const controller = useMemo(
    () =>
      new CompositorController({
        sceneId: options.sceneId,
        ...omitUndefined({ id: options.id }),
        ...omitUndefined({ baseUrl: options.baseUrl ?? options.transport.url }),
        ...omitUndefined({ extensions: options.extensions }),
        transport: options.transport,
        onError: (error) => {
          optionsRef.current.onError?.(error);
        },
        fetch: (...input) =>
          (optionsRef.current.fetch ?? globalThis.fetch.bind(globalThis))(...input),
        createObjectURL: (blob) =>
          (optionsRef.current.createObjectURL ?? URL.createObjectURL.bind(URL))(blob),
        revokeObjectURL: (url) => {
          (optionsRef.current.revokeObjectURL ?? URL.revokeObjectURL.bind(URL))(url);
        },
      }),
    [options.sceneId, options.id, options.baseUrl, options.extensions, options.transport],
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  return [controller.ref, snapshot];
}

class CompositorController {
  private readonly options: UseCompositorOptions;
  private readonly listeners = new Set<() => void>();
  private readonly serverSnapshot: CompositorSnapshot;
  private snapshot: CompositorSnapshot;
  private container: HTMLDivElement | undefined;
  private runtime: DOMRuntime | undefined;
  private unsubscribeRuntime: (() => void) | undefined;
  private abort: AbortController | undefined;
  private generation = 0;

  constructor(options: UseCompositorOptions) {
    this.options = options;
    this.serverSnapshot = {
      targetId: options.id ?? "dom",
      sceneId: options.sceneId,
      phase: "waiting-for-container" as const,
      revision: 0,
    };
    this.snapshot = this.serverSnapshot;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): CompositorSnapshot => this.snapshot;

  readonly getServerSnapshot = (): CompositorSnapshot => this.serverSnapshot;

  readonly ref: CompositorRef = (container) => {
    if (container === null) {
      this.detach();
      return;
    }
    this.attach(container);
    return () => {
      this.detach(container);
    };
  };

  private attach(container: HTMLDivElement): void {
    if (this.container === container) return;
    this.detach();
    this.container = container;
    const generation = ++this.generation;
    const abort = new AbortController();
    this.abort = abort;
    const { transport, ...runtimeOptions } = this.options;
    const runtime = new DOMRuntime({ ...runtimeOptions, container });
    this.runtime = runtime;
    this.unsubscribeRuntime = runtime.subscribe(() => {
      if (!this.isCurrent(generation, runtime)) return;
      this.publishTarget(runtime.getSnapshot());
    });
    this.publish({ phase: "connecting", revision: 0 });
    void this.consume(runtime, transport, abort.signal, generation);
  }

  /** Invalidate the current generation before aborting subscriptions and releasing its runtime and container. */
  private detach(container?: HTMLDivElement): void {
    if (container !== undefined && container !== this.container) return;
    this.generation += 1;
    this.abort?.abort();
    this.abort = undefined;
    this.unsubscribeRuntime?.();
    this.unsubscribeRuntime = undefined;
    const runtime = this.runtime;
    this.runtime = undefined;
    this.container = undefined;
    if (runtime !== undefined) void runtime.dispose();
    this.publish({ phase: "waiting-for-container", revision: 0 });
  }

  /** Ignore messages and failures from stale runtimes; publish disconnection only when the active stream ends. */
  private async consume(
    runtime: DOMRuntime,
    transport: RuntimeMessageSource,
    signal: AbortSignal,
    generation: number,
  ): Promise<void> {
    try {
      for await (const message of transport(signal)) {
        if (!this.isActive(generation, runtime, signal)) return;
        await this.consumeMessage(message, runtime, generation);
      }
      if (this.isActive(generation, runtime, signal)) {
        this.publish({
          phase: "disconnected",
          revision: this.snapshot.revision,
          message: "Runtime message stream ended.",
        });
      }
    } catch (cause) {
      if (!this.isActive(generation, runtime, signal)) return;
      const error = cause instanceof Error ? cause : new Error("DOM compositor failed.", { cause });
      this.publish({ phase: "error", revision: this.snapshot.revision, message: error.message });
      this.options.onError?.(error);
    }
  }

  /** Setup may outlive the current connection; publish completion only for its original runtime. */
  private async consumeMessage(
    message: RuntimeMessage,
    runtime: DOMRuntime,
    generation: number,
  ): Promise<void> {
    if (message.kind === "setup") {
      this.publish({ phase: "downloading-assets", revision: this.snapshot.revision });
      await runtime.setup(message);
      if (!this.isCurrent(generation, runtime)) return;
      const status = runtime.getSnapshot();
      if (status.phase === "error") this.publishTarget(status);
      else this.publish({ phase: "connecting", revision: this.snapshot.revision });
    } else if (message.kind === "update") {
      runtime.update(message.snapshot);
    } else {
      await runtime.event(message.event);
    }
  }

  private isActive(generation: number, runtime: DOMRuntime, signal: AbortSignal): boolean {
    return this.isCurrent(generation, runtime) && !signal.aborted;
  }

  private isCurrent(generation: number, runtime: DOMRuntime): boolean {
    return generation === this.generation && runtime === this.runtime;
  }

  private publishTarget(status: TargetStatus): void {
    this.publish({
      phase: status.phase,
      revision: status.settledRevision ?? 0,
      ...omitUndefined({ desiredRevision: status.desiredRevision }),
      ...omitUndefined({ settledRevision: status.settledRevision }),
      ...omitUndefined({ message: status.message }),
    });
  }

  private publish(update: Omit<CompositorSnapshot, "targetId" | "sceneId">): void {
    const next = {
      targetId: this.options.id ?? "dom",
      sceneId: this.options.sceneId,
      ...update,
    };
    if (equals(this.snapshot, next)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

export { sseRuntimeSource } from "./sse.js";
export type { RuntimeMessageSource } from "@strangecyan/vignette-core";
