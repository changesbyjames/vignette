/** Server-side snapshot streams and Fetch handlers for remote frame stores. */
import {
  encodeRemoteStoreSnapshot,
  type RemoteStoreRef,
  type RemoteStoreSnapshot,
} from "./remote-store.js";

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

/** Fetch handler that leaves requests for other paths unhandled. */
export type RemoteStoreRequestHandler = (request: Request) => Response | undefined;

/**
 * Serves a store at its reference's URL as server-sent events, one per context change, until the
 * client disconnects. Requests for any other path return undefined so hosts can fall through:
 *
 * ```ts
 * const handleTitle = createRemoteStoreHandler(titleStore, store);
 * app.get(titleStore.url, (c) => handleTitle(c.req.raw) ?? c.notFound());
 * ```
 */
export function createRemoteStoreHandler<TContext>(
  ref: RemoteStoreRef<ReadableContextStore<TContext>>,
  store: ReadableContextStore<TContext>,
): RemoteStoreRequestHandler {
  return (request) => {
    const url = new URL(request.url);
    const target = new URL(ref.url, url);
    if (
      request.method !== "GET" ||
      target.origin !== url.origin ||
      target.pathname !== url.pathname
    ) {
      return undefined;
    }
    return new Response(remoteStoreEventStream(store, request.signal), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/event-stream; charset=utf-8",
      },
    });
  };
}

/** Encodes each conflated snapshot as one SSE `data` record. */
function remoteStoreEventStream<TContext>(
  store: ReadableContextStore<TContext>,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const stop = new AbortController();
  const snapshots = remoteStoreSnapshots(store, AbortSignal.any([signal, stop.signal]))[
    Symbol.asyncIterator
  ]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await snapshots.next();
      if (next.done === true) controller.close();
      else controller.enqueue(encoder.encode(`data: ${encodeRemoteStoreSnapshot(next.value)}\n\n`));
    },
    cancel() {
      stop.abort();
    },
  });
}
