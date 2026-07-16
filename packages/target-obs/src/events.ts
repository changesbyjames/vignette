import type { ObsTransport } from "./transport.js";

export interface ObsEventHandlers {
  readonly onCollectionChanging: () => void;
  readonly onCollectionChanged: () => void;
  readonly onConnectionClosed: (error: unknown) => void;
  readonly onRemoteStateChanged: () => void;
}

export function subscribeToObsEvents(
  transport: ObsTransport,
  handlers: ObsEventHandlers,
): () => void {
  const unsubscribers = [
    transport.on("CurrentSceneCollectionChanging", handlers.onCollectionChanging),
    transport.on("CurrentSceneCollectionChanged", handlers.onCollectionChanged),
    transport.on("ConnectionClosed", handlers.onConnectionClosed),
    ...REMOTE_STATE_EVENTS.map((event) => transport.on(event, handlers.onRemoteStateChanged)),
  ];
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}

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
