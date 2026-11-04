import { readObsErrorCode } from "./errors.js";
import type { ObsTransportEvent } from "./machine.js";
import type { ObsTransport } from "./transport.js";

/** Scenes, inputs or items changed in OBS, so the last observation may be stale. */
const REMOTE_STATE_EVENTS = [
  "SceneCreated",
  "SceneRemoved",
  "SceneNameChanged",
  "InputCreated",
  "InputRemoved",
  "InputNameChanged",
  "InputSettingsChanged",
  "SceneItemCreated",
  "SceneItemRemoved",
  "SceneItemListReindexed",
  "SceneItemEnableStateChanged",
  "SceneItemTransformChanged",
];

/** Forwards the obs-websocket events the OBS machine reacts to; returns an unsubscribe function. */
export function subscribeToObsEvents(
  transport: ObsTransport,
  send: (event: ObsTransportEvent) => void,
): () => void {
  const unsubscribers = [
    transport.on("CurrentSceneCollectionChanging", () => {
      send({ type: "collectionChanging" });
    }),
    transport.on("CurrentSceneCollectionChanged", () => {
      send({ type: "collectionChanged" });
    }),
    transport.on("ConnectionClosed", (cause) => {
      const code = readObsErrorCode(cause);
      send({ type: "closed", code, error: closeError(cause, code) });
    }),
    ...REMOTE_STATE_EVENTS.map((event) =>
      transport.on(event, () => {
        send({ type: "remoteChanged" });
      }),
    ),
  ];
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}

/**
 * The error a closed connection reports. An abrupt close, such as OBS exiting or the network
 * dropping (code 1006), arrives without a reason; name the code instead of an empty message.
 */
function closeError(cause: unknown, code: number | undefined): Error {
  if (cause instanceof Error && cause.message !== "") return cause;
  const suffix = code === undefined ? "" : ` (code ${String(code)})`;
  return new Error(`The OBS connection closed${suffix}.`, { cause });
}
