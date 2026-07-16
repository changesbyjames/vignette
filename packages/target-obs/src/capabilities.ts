import type { ObsProtocolCapabilities } from "./observed-state.js";
import { obsDiagnostic, type ObsDiagnostic } from "./plan.js";

/** obs-websocket requests required for managed convergence. */
export const REQUIRED_OBS_REQUESTS: readonly string[] = [
  "GetVersion",
  "GetInputKindList",
  "GetSceneList",
  "GetInputList",
  "GetInputSettings",
  "GetSceneItemList",
  "CreateScene",
  "RemoveScene",
  "CreateInput",
  "RemoveInput",
  "SetInputSettings",
  "PressInputPropertiesButton",
  "CreateSceneItem",
  "RemoveSceneItem",
  "SetSceneItemTransform",
  "SetSceneItemIndex",
  "SetSceneItemEnabled",
];

/** Reports required obs-websocket requests that OBS does not advertise. */
export function validateObsCapabilities(
  capabilities: ObsProtocolCapabilities,
): readonly ObsDiagnostic[] {
  const available = new Set(capabilities.availableRequests);
  return REQUIRED_OBS_REQUESTS.filter((request) => !available.has(request)).map((request) =>
    obsDiagnostic(
      "OBS_MISSING_REQUEST",
      "error",
      "obs.capabilities.availableRequests",
      `OBS does not expose required request '${request}'.`,
      [request],
    ),
  );
}
