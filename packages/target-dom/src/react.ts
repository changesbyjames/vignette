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
  /** The transport delivering runtime messages, e.g. `sseRuntimeSource("/runtime")`. */
  readonly transport: RuntimeMessageSource;
}

/** Browser compositor lifecycle, including pre-runtime setup phases. */
export type CompositorPhase =
  "waiting-for-container" | "connecting" | "downloading-assets" | TargetPhase;

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
        ...(options.id === undefined ? {} : { id: options.id }),
        ...(options.extensions === undefined ? {} : { extensions: options.extensions }),
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
    [options.sceneId, options.id, options.extensions, options.transport],
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  return [controller.ref, snapshot];
}

class CompositorController {
  readonly #options: UseCompositorOptions;
  readonly #listeners = new Set<() => void>();
  readonly #serverSnapshot: CompositorSnapshot;
  #snapshot: CompositorSnapshot;
  #container: HTMLDivElement | undefined;
  #runtime: DOMRuntime | undefined;
  #unsubscribeRuntime: (() => void) | undefined;
  #abort: AbortController | undefined;
  #generation = 0;

  constructor(options: UseCompositorOptions) {
    this.#options = options;
    this.#serverSnapshot = {
      targetId: options.id ?? "dom",
      sceneId: options.sceneId,
      phase: "waiting-for-container" as const,
      revision: 0,
    };
    this.#snapshot = this.#serverSnapshot;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): CompositorSnapshot => this.#snapshot;

  readonly getServerSnapshot = (): CompositorSnapshot => this.#serverSnapshot;

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
    if (this.#container === container) return;
    this.detach();
    this.#container = container;
    const generation = ++this.#generation;
    const abort = new AbortController();
    this.#abort = abort;
    const { transport, ...runtimeOptions } = this.#options;
    const runtime = new DOMRuntime({ ...runtimeOptions, container });
    this.#runtime = runtime;
    this.#unsubscribeRuntime = runtime.subscribe(() => {
      if (!this.isCurrent(generation, runtime)) return;
      this.publishTarget(runtime.getSnapshot());
    });
    this.publish({ phase: "connecting", revision: 0 });
    void this.consume(runtime, transport, abort.signal, generation);
  }

  private detach(container?: HTMLDivElement): void {
    if (container !== undefined && container !== this.#container) return;
    this.#generation += 1;
    this.#abort?.abort();
    this.#abort = undefined;
    this.#unsubscribeRuntime?.();
    this.#unsubscribeRuntime = undefined;
    const runtime = this.#runtime;
    this.#runtime = undefined;
    this.#container = undefined;
    if (runtime !== undefined) void runtime.dispose();
    this.publish({ phase: "waiting-for-container", revision: 0 });
  }

  private async consume(
    runtime: DOMRuntime,
    transport: RuntimeMessageSource,
    signal: AbortSignal,
    generation: number,
  ): Promise<void> {
    try {
      for await (const message of transport(signal)) {
        if (!this.isCurrent(generation, runtime) || signal.aborted) return;
        if (message.kind === "setup") {
          this.publish({ phase: "downloading-assets", revision: this.#snapshot.revision });
          await runtime.setup(message.manifest);
          if (this.isCurrent(generation, runtime)) {
            this.publish({ phase: "connecting", revision: this.#snapshot.revision });
          }
        } else if (message.kind === "update") {
          runtime.update(message.snapshot);
        } else {
          await runtime.event(message.event);
        }
      }
      if (this.isCurrent(generation, runtime) && !signal.aborted) {
        this.publish({
          phase: "disconnected",
          revision: this.#snapshot.revision,
          message: "Runtime message stream ended.",
        });
      }
    } catch (cause) {
      if (!this.isCurrent(generation, runtime) || signal.aborted) return;
      const error = cause instanceof Error ? cause : new Error("DOM compositor failed.", { cause });
      this.publish({ phase: "error", revision: this.#snapshot.revision, message: error.message });
      this.#options.onError?.(error);
    }
  }

  private isCurrent(generation: number, runtime: DOMRuntime): boolean {
    return generation === this.#generation && runtime === this.#runtime;
  }

  private publishTarget(status: TargetStatus): void {
    this.publish({
      phase: status.phase,
      revision: status.settledRevision ?? 0,
      ...(status.desiredRevision === undefined ? {} : { desiredRevision: status.desiredRevision }),
      ...(status.settledRevision === undefined ? {} : { settledRevision: status.settledRevision }),
      ...(status.message === undefined ? {} : { message: status.message }),
    });
  }

  private publish(update: Omit<CompositorSnapshot, "targetId" | "sceneId">): void {
    const next = {
      targetId: this.#options.id ?? "dom",
      sceneId: this.#options.sceneId,
      ...update,
    };
    if (equals(this.#snapshot, next)) return;
    this.#snapshot = next;
    for (const listener of this.#listeners) listener();
  }
}

export { sseRuntimeSource } from "./sse.js";
export type { RuntimeMessageSource } from "@strangecyan/vignette-core";
