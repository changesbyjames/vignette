/**
 * React integration that mounts a DOM stage: a container rendered by a `DOMRuntime` consuming one
 * composer stream.
 *
 * @module
 */
import {
  omitUndefined,
  type StreamMessage,
  type StreamSource,
  type TargetPhase,
  type TargetStatus,
} from "@strangecyan/vignette-core";
import { equals } from "ramda";
import { useMemo, useRef, useSyncExternalStore, type RefCallback } from "react";

import { DOMRuntime, type DOMRuntimeOptions } from "./runtime.js";

/** DOM runtime options plus the scene to show and the composer stream to consume. */
export interface UseStageOptions extends Omit<DOMRuntimeOptions, "container" | "sceneId"> {
  readonly sceneId: string;
  /**
   * The composer stream to render, e.g. `sseStream("/stream")`. When `baseUrl` is omitted,
   * root-relative snapshot URLs resolve against the stream's `url`.
   */
  readonly stream: StreamSource;
}

/** Stage lifecycle, including the phases before the DOM runtime reports target status. */
export type StagePhase =
  | "waiting-for-container"
  | "connecting"
  | "downloading-assets"
  | TargetPhase;

/** Stable React external-store status of a mounted stage. */
export interface StageStatus {
  readonly targetId: string;
  readonly sceneId: string;
  readonly phase: StagePhase;
  readonly revision: number;
  readonly desiredRevision?: number;
  readonly settledRevision?: number;
  readonly message?: string;
}

/** Ref callback that owns the lifetime of the stage container. */
export type StageRef = RefCallback<HTMLDivElement>;
/** Container ref and current stage status returned by `useStage`. */
export type UseStageResult = readonly [ref: StageRef, status: StageStatus];

/**
 * Renders a composer stream into the returned container ref. Owns one `DOMRuntime` per attached
 * container, consumes `stream` while attached, and returns the stage's cached status.
 */
export function useStage(options: UseStageOptions): UseStageResult {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const controller = useMemo(
    () =>
      new StageController({
        sceneId: options.sceneId,
        ...omitUndefined({ id: options.id }),
        ...omitUndefined({ baseUrl: options.baseUrl ?? options.stream.url }),
        ...omitUndefined({ extensions: options.extensions }),
        stream: options.stream,
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
    [options.sceneId, options.id, options.baseUrl, options.extensions, options.stream],
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  return [controller.ref, snapshot];
}

class StageController {
  private readonly options: UseStageOptions;
  private readonly listeners = new Set<() => void>();
  private readonly serverSnapshot: StageStatus;
  private snapshot: StageStatus;
  private container: HTMLDivElement | undefined;
  private runtime: DOMRuntime | undefined;
  private unsubscribeRuntime: (() => void) | undefined;
  private abort: AbortController | undefined;
  private generation = 0;

  constructor(options: UseStageOptions) {
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

  readonly getSnapshot = (): StageStatus => this.snapshot;

  readonly getServerSnapshot = (): StageStatus => this.serverSnapshot;

  readonly ref: StageRef = (container) => {
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
    const { stream, ...runtimeOptions } = this.options;
    const runtime = new DOMRuntime({ ...runtimeOptions, container });
    this.runtime = runtime;
    this.unsubscribeRuntime = runtime.subscribe(() => {
      if (!this.isCurrent(generation, runtime)) return;
      this.publishTarget(runtime.getSnapshot());
    });
    this.publish({ phase: "connecting", revision: 0 });
    void this.consume(runtime, stream, abort.signal, generation);
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
    stream: StreamSource,
    signal: AbortSignal,
    generation: number,
  ): Promise<void> {
    try {
      for await (const message of stream(signal)) {
        if (!this.isActive(generation, runtime, signal)) return;
        await this.consumeMessage(message, runtime, generation);
      }
      if (this.isActive(generation, runtime, signal)) {
        this.publish({
          phase: "disconnected",
          revision: this.snapshot.revision,
          message: "Composer stream ended.",
        });
      }
    } catch (cause) {
      if (!this.isActive(generation, runtime, signal)) return;
      const error = cause instanceof Error ? cause : new Error("DOM stage failed.", { cause });
      this.publish({ phase: "error", revision: this.snapshot.revision, message: error.message });
      this.options.onError?.(error);
    }
  }

  /** Setup may outlive the current connection; publish completion only for its original runtime. */
  private async consumeMessage(
    message: StreamMessage,
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

  private publish(update: Omit<StageStatus, "targetId" | "sceneId">): void {
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

export { sseStream } from "./sse.js";
export type { StreamSource } from "@strangecyan/vignette-core";
