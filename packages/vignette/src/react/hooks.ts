import { use, useEffect, useRef, useSyncExternalStore } from "react";

import type { Canvas, Snapshot, SnapshotScene } from "../core/snapshot.js";
import type { SetupMessage } from "../stream/messages.js";
import { frameUrl } from "../target/plugins.js";
import type { TargetStatus } from "../target/status.js";
import type { StreamEventListener, StreamState } from "./client.js";
import { useStreamContext } from "./context.js";

function useStreamState<T>(select: (state: StreamState) => T): T {
  const { client } = useStreamContext();
  const read = () => select(client.state);
  return useSyncExternalStore(client.subscribe, read, read);
}

/** The latest snapshot the stream applied, or undefined before the first. */
export function useSnapshot(): Snapshot | undefined {
  return useStreamState((state) => state.snapshot);
}

/** The stream's setup message: show ID, canvas, asset manifest and `serve` locations. */
export function useSetup(): SetupMessage | undefined {
  return useStreamState((state) => state.setup);
}

/** The show's canvas, known from setup before the first snapshot. */
export function useCanvas(): Canvas | undefined {
  return useStreamState((state) => state.setup?.canvas ?? state.snapshot?.canvas);
}

/**
 * The stream's target status: phase (`connecting` before the first message), desired and settled
 * revision, per-source state, the last error, and the SSE connection for a `url` stream.
 */
export function useStreamStatus(): TargetStatus {
  return useStreamState((state) => state.status);
}

/**
 * The frame page URL of a frame source, `serve.frames?frame=…&source=…&stream=serve.stream`
 * (plus `&v=<build>` given the source's `build`), exactly as the DOM and OBS targets open it.
 * Suspends until the setup arrives; throws when the setup publishes no `serve.frames` and
 * `serve.stream`.
 */
export function useFrameUrl(frame: string, sourceId: string, build?: string): string {
  const { client } = useStreamContext();
  const setup = useSetup() ?? use(client.setup);
  return frameUrl(setup, frame, sourceId, build);
}

/** A scene of the latest snapshot: `id`, else the snapshot's `activeScene`, else its first. */
export function useScene(id?: string): SnapshotScene | undefined {
  return useStreamState((state) => selectScene(state.snapshot, id));
}

/** Calls `handler` with every show event, e.g. `media:restart`, until unmount. */
export function useStreamEvents(handler: StreamEventListener): void {
  const { client } = useStreamContext();
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(
    () =>
      client.listen((event) => {
        latest.current(event);
      }),
    [client],
  );
}

/** The named scene, else the active scene, else the first; undefined if absent. */
export function selectScene(
  snapshot: Snapshot | undefined,
  id: string | undefined,
): SnapshotScene | undefined {
  if (snapshot === undefined) return undefined;
  const wanted = id ?? snapshot.activeScene ?? snapshot.scenes[0]?.id;
  return snapshot.scenes.find((scene) => scene.id === wanted);
}
