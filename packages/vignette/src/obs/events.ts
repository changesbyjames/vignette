import { asError } from "../target/kernel-machine.js";
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
      const error = asError(cause, "The OBS connection closed.");
      send({ type: "closed", code: readObsErrorCode(cause), error });
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
