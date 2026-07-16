import type { AssetManifest, RuntimeEvent, RuntimeMessage } from "./runtime.js";
import type { CompiledSnapshot } from "./snapshot.js";

/**
 * The wire format shared by SSE servers and clients: one named event per runtime message.
 * Servers write `encodeRuntimeMessageSse`; clients decode each event with
 * `decodeRuntimeSseEvent`. Payloads are trusted; both ends are owned by the same project.
 */
export const RUNTIME_SSE_EVENTS = ["setup", "update", "event"] as const;

export type RuntimeSseEvent = (typeof RUNTIME_SSE_EVENTS)[number];

export function encodeRuntimeMessageSse(message: RuntimeMessage): string {
  const [id, payload] =
    message.kind === "setup"
      ? ["setup", message.manifest]
      : message.kind === "update"
        ? [String(message.snapshot.revision), message.snapshot]
        : [message.event.id, message.event];
  return `id: ${id}\nevent: ${message.kind}\ndata: ${JSON.stringify(payload)}\n\n`;
}

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
