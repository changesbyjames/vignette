import { z } from "zod";

import { AssetManifestSchema } from "../core/assets.js";
import { StableIdSchema } from "../core/ids.js";
import { CanvasSchema, SnapshotSchema } from "../core/snapshot.js";

/**
 * Absolute URLs where the host serves the stream, the assets directory and `frames.html`. The
 * composer publishes them in setup; targets never derive a location themselves.
 */
export const ServeSchema = z
  .object({ stream: z.url().optional(), assets: z.url().optional(), frames: z.url().optional() })
  .readonly();
/** Absolute URLs where the host serves the stream, the assets directory and `frames.html`. */
export type Serve = z.output<typeof ServeSchema>;

/**
 * First message of every stream, and replayed to late subscribers: the show's identity, the
 * source kinds it uses, its asset manifest and where things are served.
 */
export const SetupMessageSchema = z
  .object({
    kind: z.literal("setup"),
    id: StableIdSchema,
    canvas: CanvasSchema,
    kinds: z.array(z.string()).readonly(),
    assets: AssetManifestSchema,
    serve: ServeSchema,
  })
  .readonly();
/** First message of every stream: identity, kinds in use, asset manifest and locations. */
export type SetupMessage = z.output<typeof SetupMessageSchema>;

/** A new snapshot: the complete desired state at one revision. */
export const UpdateMessageSchema = z
  .object({ kind: z.literal("update"), snapshot: SnapshotSchema })
  .readonly();
/** A new snapshot: the complete desired state at one revision. */
export type UpdateMessage = z.output<typeof UpdateMessageSchema>;

/**
 * A one-shot command, never part of desired state, such as `{ kind: "media:restart", sourceId }`.
 * Targets handle the kinds they know and ignore the rest.
 */
export const ShowEventSchema = z.looseObject({ kind: z.string().min(1) }).readonly();
/** A one-shot command, never part of desired state. */
export type ShowEvent = z.output<typeof ShowEventSchema>;

/** Carries one {@link ShowEvent}. */
export const EventMessageSchema = z
  .object({ kind: z.literal("event"), event: ShowEventSchema })
  .readonly();
/** Carries one show event. */
export type EventMessage = z.output<typeof EventMessageSchema>;

/** One message of a stream: setup, snapshot update or one-shot event. */
export const StreamMessageSchema = z.discriminatedUnion("kind", [
  SetupMessageSchema,
  UpdateMessageSchema,
  EventMessageSchema,
]);
/** One message of a stream: setup, snapshot update or one-shot event. */
export type StreamMessage = z.output<typeof StreamMessageSchema>;
