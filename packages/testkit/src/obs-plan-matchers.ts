import type { ProjectId } from "@strangecyan/vignette-core";
import {
  OBS_PHASES,
  indexManagedObservedState,
  parseManagedName,
  type ObsOperation,
  type ObsPlan,
  type ObservedObsState,
} from "@strangecyan/vignette-target-obs";

/** Returns operation discriminators in execution order. */
export function obsOperationKinds(plan: ObsPlan): readonly ObsOperation["kind"][] {
  return plan.operations.map((operation) => operation.kind);
}

/** Reports operations that appear before an earlier required execution phase. */
export function validateObsPhaseOrder(plan: ObsPlan): readonly string[] {
  const phaseIndex = new Map(OBS_PHASES.map((phase, index) => [phase, index]));
  const errors: string[] = [];
  let previous = -1;
  for (const operation of plan.operations) {
    const current = phaseIndex.get(operation.phase) ?? -1;
    if (current < previous) {
      errors.push(`Operation '${operation.key}' appears after a later execution phase.`);
    }
    previous = Math.max(previous, current);
  }
  return errors;
}

/** Reports plan operations that touch OBS resources outside the managed project namespace. */
export function validateManagedOnlyPlan(
  plan: ObsPlan,
  observed: ObservedObsState,
  projectId: ProjectId,
): readonly string[] {
  const managed = indexManagedObservedState(observed, projectId);
  const sceneUuids = new Set([
    ...(managed.registry === undefined ? [] : [managed.registry.sceneUuid]),
    ...[...managed.scenes.values()].map((scene) => scene.sceneUuid),
  ]);
  const inputUuids = new Set([...managed.inputs.values()].map((input) => input.inputUuid));
  const errors: string[] = [];

  for (const operation of plan.operations) {
    switch (operation.kind) {
      case "create-scene": {
        const parsed = parseManagedName(operation.sceneName);
        if (parsed?.projectId !== projectId) errors.push(unmanaged(operation));
        break;
      }
      case "create-input": {
        const parsed = parseManagedName(operation.inputName);
        if (parsed?.projectId !== projectId || parsed.kind !== "source") {
          errors.push(unmanaged(operation));
        }
        break;
      }
      case "set-transform":
      case "set-order":
      case "set-enabled":
        if (
          operation.placement.kind === "existing" &&
          !sceneUuids.has(operation.placement.sceneUuid)
        ) {
          errors.push(unmanaged(operation));
        }
        break;
      case "remove-placement":
      case "remove-scene":
        if (!sceneUuids.has(operation.sceneUuid)) errors.push(unmanaged(operation));
        break;
      case "remove-input":
        if (!inputUuids.has(operation.inputUuid)) errors.push(unmanaged(operation));
        break;
      case "create-placement":
      case "set-input-settings":
        break;
    }
  }
  return errors;
}

function unmanaged(operation: ObsOperation): string {
  return `Operation '${operation.key}' touches a resource outside the managed project namespace.`;
}
