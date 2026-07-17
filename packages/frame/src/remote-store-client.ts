/** React subscription hook for state streamed to hydrated frames. */
import { useSyncExternalStore } from "react";

import {
  decodeRemoteStoreSnapshot,
  type RemoteSnapshotOf,
  type RemoteStoreRef,
  type RemoteStoreSnapshot,
} from "./remote-store.js";

interface StoreWithContext {
  getSnapshot(): { readonly context: unknown };
}

const clients = new Map<string, RemoteStoreClient>();
const serverSuspense = new Promise<never>(() => undefined);

class RemoteStoreClient {
  readonly #listeners = new Set<() => void>();
  readonly #ready: Promise<void>;
  #resolveReady: (() => void) | undefined;
  #snapshot: RemoteStoreSnapshot<unknown> | undefined;

  constructor(url: string) {
    this.#ready = new Promise<void>((resolve) => {
      this.#resolveReady = resolve;
    });

    const source = new EventSource(url);
    source.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      const snapshot = decodeRemoteStoreSnapshot(event.data);
      if (snapshot === undefined) return;

      this.#snapshot = snapshot;
      this.#resolveReady?.();
      this.#resolveReady = undefined;
      for (const listener of this.#listeners) listener();
    };
  }

  read(): RemoteStoreSnapshot<unknown> {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Suspense uses promises.
    if (this.#snapshot === undefined) throw this.#ready;
    return this.#snapshot;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getSnapshot = (): RemoteStoreSnapshot<unknown> => this.read();
}

/**
 * Selects live state from a remote store. During SSR this suspends so the nearest Suspense fallback
 * is rendered; the selected state appears after hydration receives its first snapshot.
 */
export function useRemoteStore<TRef extends RemoteStoreRef<StoreWithContext>, TSelected>(
  ref: TRef,
  selector: (snapshot: RemoteSnapshotOf<TRef>) => TSelected,
): TSelected {
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Suspense uses promises.
  if (typeof window === "undefined") throw serverSuspense;

  let client = clients.get(ref.url);
  if (client === undefined) {
    client = new RemoteStoreClient(ref.url);
    clients.set(ref.url, client);
  }

  client.read();
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  return selector(snapshot as RemoteSnapshotOf<TRef>);
}
