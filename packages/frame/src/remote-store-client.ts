import { z } from "zod";
/** React subscription hook for state streamed to hydrated frames. */
import { useSyncExternalStore } from "react";

import {
  decodeRemoteStoreSnapshot,
  type RemoteSnapshotOf,
  type RemoteStoreRef,
  type RemoteStoreSnapshot,
} from "./remote-store.js";

interface StoreWithContextGetSnapshot {
  readonly context: unknown;
}

interface StoreWithContext {
  getSnapshot(): StoreWithContextGetSnapshot;
}

const clients = new Map<string, RemoteStoreClient>();
const serverSuspense = new Promise<never>(() => undefined);

class RemoteStoreClient {
  private readonly listeners = new Set<() => void>();
  private readonly ready: Promise<void>;
  private resolveReady: (() => void) | undefined;
  private snapshot: RemoteStoreSnapshot<unknown> | undefined;

  constructor(url: string) {
    this.ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });

    const source = new EventSource(url);
    source.onmessage =
      /** Ignore malformed events, replace the current snapshot, and resolve initial suspense before notifying subscribers. */
      (event) => {
        const payload = z.string().safeParse(event.data);
        if (!payload.success) return;
        const snapshot = decodeRemoteStoreSnapshot(payload.data);
        if (snapshot === undefined) return;

        this.snapshot = snapshot;
        this.resolveReady?.();
        this.resolveReady = undefined;
        for (const listener of this.listeners) listener();
      };
  }

  read(): RemoteStoreSnapshot<unknown> {
    // oxlint-disable-next-line typescript/only-throw-error -- React Suspense uses promises.
    if (this.snapshot === undefined) throw this.ready;
    return this.snapshot;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): RemoteStoreSnapshot<unknown> => this.read();
}

/**
 * Selects live state from a remote store. During SSR and until the first snapshot arrives this
 * suspends. Frame roots already render beneath an empty Suspense boundary, so frames need no
 * boundary of their own; add one only to scope a different fallback to part of a view.
 */
export function useRemoteStore<TRef extends RemoteStoreRef<StoreWithContext>, TSelected>(
  ref: TRef,
  selector: (snapshot: RemoteSnapshotOf<TRef>) => TSelected,
): TSelected {
  // oxlint-disable-next-line typescript/only-throw-error -- React Suspense uses promises.
  if (globalThis.window === undefined) throw serverSuspense;

  let client = clients.get(ref.url);
  if (client === undefined) {
    client = new RemoteStoreClient(ref.url);
    clients.set(ref.url, client);
  }

  client.read();
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  return selector(
    /* SAFETY: The typed reference and selector share the same server-owned store URL; only that store publishes this context. */ snapshot as RemoteSnapshotOf<TRef>,
  );
}
