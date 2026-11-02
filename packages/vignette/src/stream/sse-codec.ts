import { z } from "zod";

import {
  EventMessageSchema,
  SetupMessageSchema,
  UpdateMessageSchema,
  type StreamMessage,
} from "./messages.js";

/**
 * The SSE wire format: one named event per stream message. Servers write `toSseEvent` or
 * `encodeStreamMessageSse`; clients decode each event with `decodeStreamSseEvent`, which
 * validates the payload against the message schemas.
 */
export const STREAM_SSE_EVENTS = ["setup", "update", "event"] as const;

/** Named SSE event corresponding to a stream message kind. */
export type StreamSseEvent = (typeof STREAM_SSE_EVENTS)[number];

/** Platform-neutral fields for one SSE event. */
export interface StreamSseEventRecord {
  readonly id: string;
  readonly event: StreamSseEvent;
  readonly data: string;
}

/** Converts one stream message to fields that a platform-owned SSE writer can consume. */
export function toSseEvent(message: StreamMessage): StreamSseEventRecord {
  switch (message.kind) {
    case "setup": {
      const { kind, ...setup } = message;
      return { id: kind, event: kind, data: JSON.stringify(setup) };
    }
    case "update":
      return {
        id: String(message.snapshot.revision),
        event: message.kind,
        data: JSON.stringify(message.snapshot),
      };
    case "event":
      return {
        id: `event:${message.event.kind}`,
        event: message.kind,
        data: JSON.stringify(message.event),
      };
  }
}

/** Encodes one stream message as a named SSE record. */
export function encodeStreamMessageSse(message: StreamMessage): string {
  const event = toSseEvent(message);
  return `id: ${event.id}\nevent: ${event.event}\ndata: ${event.data}\n\n`;
}

/** Validates and decodes SSE event data into a stream message. */
export function decodeStreamSseEvent(event: StreamSseEvent, data: string): StreamMessage {
  const payload: unknown = JSON.parse(data);
  switch (event) {
    case "setup":
      return SetupMessageSchema.parse({
        ...z.record(z.string(), z.json()).parse(payload),
        kind: event,
      });
    case "update":
      return UpdateMessageSchema.parse({ kind: event, snapshot: payload });
    case "event":
      return EventMessageSchema.parse({ kind: event, event: payload });
  }
}
