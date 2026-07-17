/** Pure server-side snapshot stream for remote frame stores. */
import type { RemoteStoreSnapshot } from "./remote-store.js";

/** Structural contract implemented by context stores such as `@xstate/store`. */
export interface ReadableContextStore<TContext> {
  getSnapshot(): { readonly context: TContext };
  subscribe(listener: (snapshot: { readonly context: TContext }) => void): {
    unsubscribe(): void;
  };
}

/** Replays the current context, then conflates live updates while the consumer is busy. */
export async function* remoteStoreSnapshots<TContext>(
  store: ReadableContextStore<TContext>,
  signal?: AbortSignal,
): AsyncIterable<RemoteStoreSnapshot<TContext>> {
  let pending: RemoteStoreSnapshot<TContext> | undefined = {
    context: store.getSnapshot().context,
  };
  let wake: (() => void) | undefined;
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
    while (!stopped) {
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
