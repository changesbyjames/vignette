import type { AssetManifest, RuntimeEvent, RuntimeMessage } from "./runtime.js";
import type { CompiledSnapshot } from "./snapshot.js";

/**
 * The wire format shared by SSE servers and clients: one named event per runtime message.
 * Servers write `encodeRuntimeMessageSse`; clients decode each event with
 * `decodeRuntimeSseEvent`. Payloads are trusted; both ends are owned by the same project.
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
      ? ["setup", message.manifest]
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

/** Decodes trusted SSE event data into a runtime message. */
export function decodeRuntimeSseEvent(event: RuntimeSseEvent, data: string): RuntimeMessage {
  switch (event) {
    case "setup":
      return { kind: "setup", manifest: JSON.parse(data) as AssetManifest };
    case "update":
      return { kind: "update", snapshot: JSON.parse(data) as CompiledSnapshot };
    case "event":
      return { kind: "event", event: JSON.parse(data) as RuntimeEvent };
  }
}
