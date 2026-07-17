/** Typed references and wire values for state streamed to hydrated frames. */

interface StoreWithContext {
  getSnapshot(): { readonly context: unknown };
}

declare const storeType: unique symbol;

/** A typed reference to a server-owned store and its application-owned endpoint. */
export interface RemoteStoreRef<TStore extends StoreWithContext> {
  readonly id: string;
  readonly url: string;
  readonly [storeType]?: TStore;
}

/** The context snapshot carried by a remote store reference. */
export type RemoteSnapshotOf<TRef extends RemoteStoreRef<StoreWithContext>> =
  TRef extends RemoteStoreRef<infer TStore>
    ? Pick<ReturnType<TStore["getSnapshot"]>, "context">
    : never;

/** Options identifying a remote store and the SSE endpoint that serves it. */
export interface RemoteStoreOptions {
  readonly id: string;
  readonly url: string;
}

/** Defines a typed reference shared by frame and server code. */
export function defineRemoteStore<TStore extends StoreWithContext>(
  options: RemoteStoreOptions,
): RemoteStoreRef<TStore> {
  if (options.id.length === 0) throw new TypeError("Remote store ID must not be empty.");
  if (options.url.length === 0) throw new TypeError("Remote store URL must not be empty.");
  return Object.freeze({ id: options.id, url: options.url });
}

/** A context snapshot transmitted to a remote frame. */
export interface RemoteStoreSnapshot<TContext> {
  readonly context: TContext;
}

/** Encodes one trusted remote store snapshot for an SSE data field. */
export function encodeRemoteStoreSnapshot(snapshot: RemoteStoreSnapshot<unknown>): string {
  return JSON.stringify(snapshot);
}

/** Decodes an SSE data field, ignoring malformed or unrelated messages. */
export function decodeRemoteStoreSnapshot(data: string): RemoteStoreSnapshot<unknown> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(data) as unknown;
  } catch {
    return undefined;
  }
  return typeof value === "object" && value !== null && "context" in value ? value : undefined;
}
