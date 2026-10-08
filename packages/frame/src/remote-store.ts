import { z } from "zod";
interface StoreWithContextGetSnapshot {
  readonly context: unknown;
}
/** Typed references and wire values for state streamed to hydrated frames. */

interface StoreWithContext {
  getSnapshot(): StoreWithContextGetSnapshot;
}

declare const storeType: unique symbol;

/** Path prefix of conventional remote store endpoints: `/__vignette/store/<id>`. */
export const REMOTE_STORE_ROUTE_PREFIX = "/__vignette/store";

/** A typed reference to a server-owned store and the SSE endpoint the application serves it at. */
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

/** Options identifying a remote store and, optionally, a non-conventional SSE endpoint. */
export interface RemoteStoreOptions {
  readonly id: string;
  /** SSE endpoint serving the store. Defaults to `/__vignette/store/<id>`. */
  readonly url?: string | undefined;
}

/**
 * Defines a typed reference shared by frame and server code. The endpoint defaults to
 * `/__vignette/store/<id>`, so the server registers its route at `ref.url`:
 *
 * ```ts
 * export const titleStore = defineRemoteStore<TitleStore>({ id: "title" });
 * app.get(titleStore.url, (context) => streamSSE(context, ...));
 * ```
 */
export function defineRemoteStore<TStore extends StoreWithContext>(
  options: RemoteStoreOptions,
): RemoteStoreRef<TStore> {
  if (options.id.length === 0) throw new TypeError("Remote store ID must not be empty.");
  const url = options.url ?? `${REMOTE_STORE_ROUTE_PREFIX}/${encodeURIComponent(options.id)}`;
  if (url.length === 0) throw new TypeError("Remote store URL must not be empty.");
  // oxlint-disable-next-line house/no-object-freeze -- The reference carries immutable application-owned routing into a frame.
  return Object.freeze({ id: options.id, url });
}

/** A context snapshot transmitted to a remote frame. */
export interface RemoteStoreSnapshot<TContext> {
  readonly context: TContext;
}

/** Encodes one trusted remote store snapshot for an SSE data field. */
export function encodeRemoteStoreSnapshot(snapshot: RemoteStoreSnapshot<unknown>): string {
  return JSON.stringify(snapshot);
}

export const RemoteStoreWireSchema = z
  .object({ context: z.unknown() })
  .loose()
  .refine((value) => Object.hasOwn(value, "context"));
export type RemoteStoreWire = z.output<typeof RemoteStoreWireSchema>;

/** Decode only messages carrying a context field; unrelated or malformed data is ignored. */
export function decodeRemoteStoreSnapshot(
  data: string,
): RemoteStoreSnapshot<RemoteStoreWire["context"]> | undefined {
  try {
    return RemoteStoreWireSchema.safeParse(JSON.parse(data)).data;
  } catch {
    return undefined;
  }
}
