import type { StreamMessage } from "./stream.js";
import {
  CompiledSnapshotWireSchema,
  StreamEventWireSchema,
  StreamSetupWireSchema,
} from "./wire-schemas.js";

/**
 * The wire format shared by SSE servers and clients: one named event per stream message.
 * Servers write `encodeStreamMessageSse`; clients decode each event with
 * `decodeStreamSseEvent`. Payloads are decoded against their runtime contracts before consumption.
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
  const [id, payload] =
    message.kind === "setup"
      ? [
          "setup",
          {
            projectId: message.projectId,
            manifest: message.manifest,
            extensions: message.extensions,
          },
        ]
      : message.kind === "update"
        ? [String(message.snapshot.revision), message.snapshot]
        : [message.event.id, message.event];
  return { id, event: message.kind, data: JSON.stringify(payload) };
}

/** Encodes one stream message as a named SSE record. */
export function encodeStreamMessageSse(message: StreamMessage): string {
  const event = toSseEvent(message);
  return `id: ${event.id}\nevent: ${event.event}\ndata: ${event.data}\n\n`;
}

/** Validates and decodes SSE event data into a stream message. */
export function decodeStreamSseEvent(event: StreamSseEvent, data: string): StreamMessage {
  switch (event) {
    case "setup":
      return { kind: "setup", ...StreamSetupWireSchema.parse(JSON.parse(data)) };
    case "update":
      return { kind: "update", snapshot: CompiledSnapshotWireSchema.parse(JSON.parse(data)) };
    case "event":
      return { kind: "event", event: StreamEventWireSchema.parse(JSON.parse(data)) };
  }
}
