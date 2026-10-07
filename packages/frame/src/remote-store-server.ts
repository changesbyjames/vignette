/** Pure server-side snapshot stream for remote frame stores. */
import type { RemoteStoreSnapshot } from "./remote-store.js";

interface ReadableContextStoreGetSnapshot<TContext> {
  readonly context: TContext;
}

interface ReadableContextStoreSubscribeListenerSnapshot<TContext> {
  readonly context: TContext;
}

interface ReadableContextStoreSubscribe {
  unsubscribe(): void;
}

/** Structural contract implemented by context stores such as `@xstate/store`. */
export interface ReadableContextStore<TContext> {
  getSnapshot(): ReadableContextStoreGetSnapshot<TContext>;
  subscribe(
    listener: (snapshot: ReadableContextStoreSubscribeListenerSnapshot<TContext>) => void,
  ): ReadableContextStoreSubscribe;
}

/** Replays the current context, then conflates live updates while the consumer is busy. */
export async function* remoteStoreSnapshots<TContext>(
  store: ReadableContextStore<TContext>,
  signal?: AbortSignal,
): AsyncIterable<RemoteStoreSnapshot<TContext>> {
  let pending: RemoteStoreSnapshot<TContext> | undefined = {
    context: store.getSnapshot().context,
  };
  let wake: (() => void) | undefined = undefined;
  let stopped = signal?.aborted ?? false;

  const stop = (): void => {
    stopped = true;
    wake?.();
    wake = undefined;
  };
  const subscription = store.subscribe((snapshot) => {
    pending = { context: snapshot.context };
    wake?.();
    wake = undefined;
  });
  signal?.addEventListener("abort", stop, { once: true });

  try {
    // Coalesce store updates while waiting, emit the newest snapshot, and release the subscription on abort.

    while (!stopped) {
      // Coalesce store updates while waiting, emit the newest snapshot, and release the subscription on abort.

      if (pending === undefined) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      if (signal?.aborted === true) break;

      const snapshot = pending;
      pending = undefined;
      if (snapshot !== undefined) yield snapshot;
    }
  } finally {
    signal?.removeEventListener("abort", stop);
    subscription.unsubscribe();
  }
}
