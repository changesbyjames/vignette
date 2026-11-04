import { z } from "zod";

import { ObsExecutionError, ObsRequestError, RESOURCE_NOT_FOUND } from "./errors.js";
import { managedSceneName, managedSourceName, registrySceneName } from "./naming.js";
import {
  OBS_PHASES,
  operationsInPhase,
  type ObsJsonObject,
  type ObsOperation,
  type ObsPlacementRef,
  type ObsPlan,
  type ObsPlanPhase,
} from "./operations.js";
import type { ObsBatchRequest, ObsTransport } from "./transport.js";

/** A scene item address: its scene selector and ID. */
interface SceneItemAddress {
  readonly scene: ObsJsonObject;
  readonly sceneItemId: number;
}

/** The `sceneItemId` of a `CreateSceneItem` response. */
const CreatedItemSchema = z.object({ sceneItemId: z.number() });
/** The `sceneItemId` of a `CreateSceneItem` response. */
type CreatedItem = z.output<typeof CreatedItemSchema>;

/**
 * Executes a plan phase by phase. `isValid` is checked before each phase and before each
 * unbatched operation; once it is false execution stops and reports `interrupted`, because the
 * observation the plan was made from no longer holds.
 */
export async function executeObsPlan(
  transport: ObsTransport,
  plan: ObsPlan,
  isValid: () => boolean,
): Promise<ObsExecutionResult> {
  const created = new Map<string, SceneItemAddress>();
  for (const phase of OBS_PHASES) {
    // Phases run in order; batched phases go as one request, the others one by one so created
    // addresses are known and validity is checked between them.
    if (!isValid()) return { interrupted: true };
    const operations = operationsInPhase(plan, phase);
    if (operations.length === 0) continue;
    if (BATCHED_PHASES.has(phase)) {
      await executeBatch(transport, plan.show, operations, created);
    } else {
      for (const operation of operations) {
        if (!isValid()) return { interrupted: true };
        await executeOperation(transport, plan.show, operation, created);
      }
    }
  }
  return { interrupted: false };
}

/** Whether execution stopped early because its observation became stale. */
export interface ObsExecutionResult {
  readonly interrupted: boolean;
}

/** Phases that never create addresses later operations need, so they can be one batch. */
const BATCHED_PHASES: ReadonlySet<ObsPlanPhase> = new Set([
  "settings",
  "transforms",
  "ordering",
  "enable",
  "remove-placements",
  "remove-scenes",
  "remove-inputs",
]);

/** Sends a phase as one batch and fails at the first unsuccessful response. */
async function executeBatch(
  transport: ObsTransport,
  show: string,
  operations: readonly ObsOperation[],
  created: ReadonlyMap<string, SceneItemAddress>,
): Promise<void> {
  const first = operations[0]?.key ?? "batch";
  let requests: readonly ObsBatchRequest[] = [];
  try {
    requests = operations.map((operation) => operationRequest(operation, show, created));
  } catch (cause) {
    throw new ObsExecutionError(first, cause);
  }
  let responses: Awaited<ReturnType<ObsTransport["callBatch"]>> = [];
  try {
    responses = await transport.callBatch(requests);
  } catch (cause) {
    throw new ObsExecutionError(first, cause);
  }
  for (const [index, operation] of operations.entries()) {
    const response = responses[index];
    if (response === undefined) {
      throw new ObsExecutionError(
        operation.key,
        new Error("OBS returned too few batch responses."),
      );
    }
    if (!response.ok && !alreadyGone(operation, response.code)) {
      throw new ObsExecutionError(
        operation.key,
        new ObsRequestError(response.requestType, response.code, response.comment),
      );
    }
  }
}

/**
 * A removal of something OBS no longer has is done. OBS frees an input when the last scene item
 * showing it goes, so `RemoveInput` after removing a gone input's items finds nothing; and an
 * operator may delete something between observation and execution. (`RemoveInput` alone is no
 * help: OBS 33 answers success and keeps an input that scene items still show.)
 */
function alreadyGone(operation: ObsOperation, code: number): boolean {
  return operation.phase.startsWith("remove-") && code === RESOURCE_NOT_FOUND;
}

async function executeOperation(
  transport: ObsTransport,
  show: string,
  operation: ObsOperation,
  created: Map<string, SceneItemAddress>,
): Promise<void> {
  try {
    const request = operationRequest(operation, show, created);
    const response = await transport.call(request.requestType, request.requestData);
    if (operation.kind === "create-placement") {
      const item: CreatedItem = CreatedItemSchema.parse(response);
      created.set(createdKey(operation.sceneId, operation.layerId), {
        scene: { sceneName: managedSceneName(show, operation.sceneId) },
        sceneItemId: item.sceneItemId,
      });
    }
  } catch (cause) {
    throw new ObsExecutionError(operation.key, cause);
  }
}

/** The obs-websocket request for one operation; created placements resolve to their new IDs. */
function operationRequest(
  operation: ObsOperation,
  show: string,
  created: ReadonlyMap<string, SceneItemAddress>,
): ObsBatchRequest {
  switch (operation.kind) {
    case "create-scene":
      return { requestType: "CreateScene", requestData: { sceneName: operation.sceneName } };
    case "create-input":
      return {
        requestType: "CreateInput",
        requestData: {
          sceneName: registrySceneName(show),
          inputName: operation.inputName,
          inputKind: operation.inputKind,
          inputSettings: operation.inputSettings,
          sceneItemEnabled: false,
        },
      };
    case "create-placement":
      return {
        requestType: "CreateSceneItem",
        requestData: {
          sceneName: managedSceneName(show, operation.sceneId),
          sourceName: managedSourceName(show, operation.sourceId),
          sceneItemEnabled: false,
        },
      };
    case "set-input-settings":
      return {
        requestType: "SetInputSettings",
        requestData: {
          inputName: managedSourceName(show, operation.sourceId),
          inputSettings: operation.inputSettings,
          overlay: false,
        },
      };
    case "set-input-mute":
      return {
        requestType: "SetInputMute",
        requestData: {
          inputName: managedSourceName(show, operation.sourceId),
          inputMuted: operation.muted,
        },
      };
    case "set-program-scene":
      return {
        requestType: "SetCurrentProgramScene",
        requestData: { sceneName: managedSceneName(show, operation.sceneId) },
      };
    default:
      return itemRequest(operation, created);
  }
}

/** Requests that address an existing or created scene item, and removals by observed UUID. */
function itemRequest(
  operation: ObsOperation,
  created: ReadonlyMap<string, SceneItemAddress>,
): ObsBatchRequest {
  switch (operation.kind) {
    case "set-transform":
      return itemCall("SetSceneItemTransform", operation.placement, created, {
        sceneItemTransform: operation.transform,
      });
    case "set-order":
      return itemCall("SetSceneItemIndex", operation.placement, created, {
        sceneItemIndex: operation.sceneItemIndex,
      });
    case "set-enabled":
      return itemCall("SetSceneItemEnabled", operation.placement, created, {
        sceneItemEnabled: operation.enabled,
      });
    case "remove-placement":
      return {
        requestType: "RemoveSceneItem",
        requestData: { sceneUuid: operation.sceneUuid, sceneItemId: operation.sceneItemId },
      };
    case "remove-scene":
      return { requestType: "RemoveScene", requestData: { sceneUuid: operation.sceneUuid } };
    case "remove-input":
      return { requestType: "RemoveInput", requestData: { inputUuid: operation.inputUuid } };
    default:
      throw new Error(`Operation '${operation.key}' has no scene-item request.`);
  }
}

function itemCall(
  requestType: string,
  ref: ObsPlacementRef,
  created: ReadonlyMap<string, SceneItemAddress>,
  data: ObsJsonObject,
): ObsBatchRequest {
  const address =
    ref.kind === "existing"
      ? { scene: { sceneUuid: ref.sceneUuid }, sceneItemId: ref.sceneItemId }
      : created.get(createdKey(ref.sceneId, ref.layerId));
  if (address === undefined) throw new Error("A scene item was addressed before it was created.");
  return {
    requestType,
    requestData: { ...address.scene, sceneItemId: address.sceneItemId, ...data },
  };
}

function createdKey(sceneId: string, layerId: string): string {
  return `${sceneId}:${layerId}`;
}
