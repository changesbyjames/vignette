import { z } from "zod";
interface StoreWithContextGetSnapshot {
  readonly context: unknown;
}
/** Typed references and wire values for state streamed to hydrated frames. */

interface StoreWithContext {
  getSnapshot(): StoreWithContextGetSnapshot;
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
  // oxlint-disable-next-line house/no-object-freeze -- The reference carries immutable application-owned routing into a frame.
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
