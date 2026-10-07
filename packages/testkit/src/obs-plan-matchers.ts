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
    if (!isManagedOperation(operation, projectId, sceneUuids, inputUuids))
      errors.push(unmanaged(operation));
  }
  return errors;
}

function unmanaged(operation: ObsOperation): string {
  return `Operation '${operation.key}' touches a resource outside the managed project namespace.`;
}

/** Creation names and destructive UUIDs must both belong to the same managed namespace. */
function isManagedOperation(
  operation: ObsOperation,
  projectId: ProjectId,
  sceneUuids: ReadonlySet<string>,
  inputUuids: ReadonlySet<string>,
): boolean {
  if (operation.kind === "create-scene")
    return parseManagedName(operation.sceneName)?.projectId === projectId;
  if (operation.kind === "create-input") {
    const parsed = parseManagedName(operation.inputName);
    return parsed?.projectId === projectId && parsed.kind === "source";
  }
  return hasManagedAddress(operation, sceneUuids, inputUuids);
}
/** Newly created references are safe; observed placement and removal addresses require membership. */
function hasManagedAddress(
  operation: ObsOperation,
  sceneUuids: ReadonlySet<string>,
  inputUuids: ReadonlySet<string>,
): boolean {
  switch (operation.kind) {
    case "set-transform":
    case "set-order":
    case "set-enabled":
      return (
        operation.placement.kind !== "existing" || sceneUuids.has(operation.placement.sceneUuid)
      );
    case "remove-placement":
    case "remove-scene":
      return sceneUuids.has(operation.sceneUuid);
    case "remove-input":
      return inputUuids.has(operation.inputUuid);
    default:
      return true;
  }
}
