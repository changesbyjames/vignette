import type { RuntimeMessage } from "./runtime.js";
import {
  CompiledSnapshotWireSchema,
  RuntimeEventWireSchema,
  RuntimeSetupWireSchema,
} from "./wire-schemas.js";

/**
 * The wire format shared by SSE servers and clients: one named event per runtime message.
 * Servers write `encodeRuntimeMessageSse`; clients decode each event with
 * `decodeRuntimeSseEvent`. Payloads are decoded against their runtime contracts before consumption.
 */
export const RUNTIME_SSE_EVENTS = ["setup", "update", "event"] as const;

/** Named SSE event corresponding to a runtime message kind. */
export type RuntimeSseEvent = (typeof RUNTIME_SSE_EVENTS)[number];

/** Platform-neutral fields for one SSE event. */
export interface RuntimeSseEventRecord {
  readonly id: string;
  readonly event: RuntimeSseEvent;
  readonly data: string;
}

/** Converts one runtime message to fields that a platform-owned SSE writer can consume. */
export function toSseEvent(message: RuntimeMessage): RuntimeSseEventRecord {
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

/** Encodes one runtime message as a named SSE record. */
export function encodeRuntimeMessageSse(message: RuntimeMessage): string {
  const event = toSseEvent(message);
  return `id: ${event.id}\nevent: ${event.event}\ndata: ${event.data}\n\n`;
}

/** Validates and decodes SSE event data into a runtime message. */
export function decodeRuntimeSseEvent(event: RuntimeSseEvent, data: string): RuntimeMessage {
  switch (event) {
    case "setup":
      return { kind: "setup", ...RuntimeSetupWireSchema.parse(JSON.parse(data)) };
    case "update":
      return { kind: "update", snapshot: CompiledSnapshotWireSchema.parse(JSON.parse(data)) };
    case "event":
      return { kind: "event", event: RuntimeEventWireSchema.parse(JSON.parse(data)) };
  }
}
