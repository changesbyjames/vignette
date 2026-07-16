import type { ProjectId } from "@cbj/vignette-core";

import { ObsExecutionError, ObsRequestError } from "./errors.js";
import { managedSceneName, managedSourceName, registrySceneName } from "./naming.js";
import {
  OBS_PHASES,
  operationsInPhase,
  type ObsContentRef,
  type ObsJsonObject,
  type ObsOperation,
  type ObsPlacementRef,
  type ObsPlan,
  type ObsSceneRef,
} from "./operations.js";
import type { ObsTransport } from "./transport.js";
import type { ObsBatchRequest } from "./transport.js";

interface SceneItemAddress {
  readonly scene: ObsJsonObject;
  readonly sceneItemId: number;
}

/** Project namespace and validity guards used during plan execution. */
export interface ObsExecutionContext {
  readonly projectId: ProjectId;
  readonly isCurrentRevision: (revision: number) => boolean;
  readonly isExecutionValid?: () => boolean;
}

/** Confirmed operation keys and interruption state from one execution. */
export interface ObsExecutionResult {
  readonly completedOperationKeys: readonly string[];
  readonly skippedDestructiveWork: boolean;
  readonly interrupted: boolean;
}

/** Executes an OBS plan phase-by-phase while guarding stale destructive work. */
export async function executeObsPlan(
  transport: ObsTransport,
  plan: ObsPlan,
  context: ObsExecutionContext,
): Promise<ObsExecutionResult> {
  const createdPlacements = new Map<string, SceneItemAddress>();
  const completed: string[] = [];
  let skippedDestructiveWork = false;

  for (const phase of OBS_PHASES) {
    if (context.isExecutionValid?.() === false) {
      return executionResult(completed, skippedDestructiveWork, true);
    }
    const operations = operationsInPhase(plan, phase);
    if (operations.length === 0) continue;
    if (operations[0]?.destructive === true && !context.isCurrentRevision(plan.revision)) {
      skippedDestructiveWork = true;
      continue;
    }

    if (isBatchablePhase(phase)) {
      try {
        const phaseCompleted = await executeBatch(
          transport,
          operations,
          context.projectId,
          createdPlacements,
        );
        completed.push(...phaseCompleted);
      } catch (cause) {
        if (cause instanceof ObsExecutionError) throw cause;
        throw new ObsExecutionError(operations[0]?.key ?? phase, cause);
      }
      continue;
    }

    for (const operation of operations) {
      if (context.isExecutionValid?.() === false) {
        return executionResult(completed, skippedDestructiveWork, true);
      }
      try {
        await executeOperation(transport, operation, context.projectId, createdPlacements);
        completed.push(operation.key);
      } catch (cause) {
        throw new ObsExecutionError(operation.key, cause);
      }
    }
  }

  return executionResult(completed, skippedDestructiveWork, false);
}

async function executeBatch(
  transport: ObsTransport,
  operations: readonly ObsOperation[],
  projectId: ProjectId,
  placements: ReadonlyMap<string, SceneItemAddress>,
): Promise<readonly string[]> {
  const requests = operations.map((operation) =>
    operationRequest(operation, projectId, placements),
  );
  const responses = await transport.callBatch(requests);
  if (responses.length !== operations.length) {
    throw new Error(
      `OBS batch returned ${String(responses.length)} responses for ${String(operations.length)} requests.`,
    );
  }

  const completed: string[] = [];
  for (const [index, operation] of operations.entries()) {
    const response = responses[index];
    if (response === undefined) throw new Error("OBS batch response ordering was incomplete.");
    if (!response.ok) {
      throw new ObsExecutionError(
        operation.key,
        new ObsRequestError(response.requestType, response.code, response.comment),
      );
    }
    completed.push(operation.key);
  }
  return completed;
}

function executionResult(
  completed: readonly string[],
  skippedDestructiveWork: boolean,
  interrupted: boolean,
): ObsExecutionResult {
  return {
    completedOperationKeys: completed,
    skippedDestructiveWork,
    interrupted,
  };
}

async function executeOperation(
  transport: ObsTransport,
  operation: ObsOperation,
  projectId: ProjectId,
  placements: Map<string, SceneItemAddress>,
): Promise<void> {
  const request = operationRequest(operation, projectId, placements);
  const response = await transport.call(request.requestType, request.requestData);
  if (operation.kind === "create-placement") {
    const sceneItemId = response.sceneItemId;
    if (typeof sceneItemId !== "number") {
      throw new Error("CreateSceneItem response did not contain a sceneItemId.");
    }
    placements.set(placementKey(operation.scene, operation.layerId), {
      scene: sceneSelector(operation.scene, projectId),
      sceneItemId,
    });
  }
}

function operationRequest(
  operation: ObsOperation,
  projectId: ProjectId,
  placements: ReadonlyMap<string, SceneItemAddress>,
): ObsBatchRequest {
  switch (operation.kind) {
    case "create-scene":
      return { requestType: "CreateScene", requestData: { sceneName: operation.sceneName } };
    case "create-input":
      return {
        requestType: "CreateInput",
        requestData: {
          sceneName: registrySceneName(projectId),
          inputName: operation.inputName,
          inputKind: operation.inputKind,
          inputSettings: operation.inputSettings,
          sceneItemEnabled: false,
        },
      };
    case "create-placement": {
      const scene = sceneSelector(operation.scene, projectId);
      return {
        requestType: "CreateSceneItem",
        requestData: {
          ...scene,
          ...contentSelector(operation.content, projectId),
          sceneItemEnabled: false,
        },
      };
    }
    case "set-input-settings":
      return {
        requestType: "SetInputSettings",
        requestData: {
          inputName: managedSourceName(projectId, operation.sourceId),
          inputSettings: operation.inputSettings,
          overlay: false,
        },
      };
    case "set-transform": {
      const address = resolvePlacement(operation.placement, placements);
      return {
        requestType: "SetSceneItemTransform",
        requestData: {
          ...address.scene,
          sceneItemId: address.sceneItemId,
          sceneItemTransform: operation.transform,
        },
      };
    }
    case "set-order": {
      const address = resolvePlacement(operation.placement, placements);
      return {
        requestType: "SetSceneItemIndex",
        requestData: {
          ...address.scene,
          sceneItemId: address.sceneItemId,
          sceneItemIndex: operation.sceneItemIndex,
        },
      };
    }
    case "set-enabled": {
      const address = resolvePlacement(operation.placement, placements);
      return {
        requestType: "SetSceneItemEnabled",
        requestData: {
          ...address.scene,
          sceneItemId: address.sceneItemId,
          sceneItemEnabled: operation.enabled,
        },
      };
    }
    case "remove-placement":
      return {
        requestType: "RemoveSceneItem",
        requestData: {
          sceneUuid: operation.sceneUuid,
          sceneItemId: operation.sceneItemId,
        },
      };
    case "remove-scene":
      return {
        requestType: "RemoveScene",
        requestData: { sceneUuid: operation.sceneUuid },
      };
    case "remove-input":
      return {
        requestType: "RemoveInput",
        requestData: { inputUuid: operation.inputUuid },
      };
  }
}

function isBatchablePhase(phase: ObsPlan["operations"][number]["phase"]): boolean {
  return (
    phase === "settings" ||
    phase === "transforms" ||
    phase === "ordering" ||
    phase === "enable" ||
    phase === "remove-placements" ||
    phase === "remove-scenes" ||
    phase === "remove-inputs"
  );
}

function resolvePlacement(
  ref: ObsPlacementRef,
  placements: ReadonlyMap<string, SceneItemAddress>,
): SceneItemAddress {
  if (ref.kind === "existing") {
    return { scene: { sceneUuid: ref.sceneUuid }, sceneItemId: ref.sceneItemId };
  }
  const result = placements.get(placementKey(ref.scene, ref.layerId));
  if (result === undefined) throw new Error(`Placement '${ref.layerId}' has not been created.`);
  return result;
}

function sceneSelector(ref: ObsSceneRef, projectId: ProjectId): ObsJsonObject {
  return {
    sceneName:
      ref.kind === "registry"
        ? registrySceneName(projectId)
        : managedSceneName(projectId, ref.sceneId),
  };
}

function contentSelector(ref: ObsContentRef, projectId: ProjectId): ObsJsonObject {
  return ref.kind === "input"
    ? { sourceName: managedSourceName(projectId, ref.sourceId) }
    : { sourceName: managedSceneName(projectId, ref.sceneId) };
}

function placementKey(scene: ObsSceneRef, layerId: string): string {
  return `${scene.kind === "registry" ? "registry" : scene.sceneId}:${layerId}`;
}
