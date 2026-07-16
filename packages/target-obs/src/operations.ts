import type { LayerId, SceneId, SourceId } from "@cbj/vignette-core";

/** JSON primitive accepted by obs-websocket settings. */
export type ObsJsonPrimitive = string | number | boolean | null;
/** Recursive JSON value accepted by obs-websocket settings. */
export type ObsJsonValue = ObsJsonPrimitive | ObsJsonObject | readonly ObsJsonValue[];
/** String-keyed JSON object accepted by obs-websocket requests. */
export interface ObsJsonObject {
  readonly [key: string]: ObsJsonValue;
}

/** OBS scene-item transform compiled from target-neutral placement geometry. */
export interface ObsSceneItemTransform extends ObsJsonObject {
  readonly positionX: number;
  readonly positionY: number;
  readonly rotation: number;
  readonly alignment: number;
  readonly boundsType: string;
  readonly boundsAlignment: number;
  readonly boundsWidth: number;
  readonly boundsHeight: number;
  readonly cropTop: number;
  readonly cropRight: number;
  readonly cropBottom: number;
  readonly cropLeft: number;
}

/** Dependency-ordered execution phase for an OBS operation. */
export type ObsPlanPhase =
  | "scenes"
  | "inputs"
  | "placements"
  | "settings"
  | "transforms"
  | "ordering"
  | "enable"
  | "remove-placements"
  | "remove-scenes"
  | "remove-inputs";

interface ObsOperationBase {
  readonly key: string;
  readonly phase: ObsPlanPhase;
  readonly dependsOn: readonly string[];
  readonly destructive: boolean;
}

/** Symbolic reference to the registry or a managed scene. */
export type ObsSceneRef =
  { readonly kind: "registry" } | { readonly kind: "scene"; readonly sceneId: SceneId };

/** Symbolic reference to managed input or nested-scene content. */
export type ObsContentRef =
  | { readonly kind: "input"; readonly sourceId: SourceId }
  | { readonly kind: "scene"; readonly sceneId: SceneId };

/** Existing or newly-created scene-item placement reference. */
export type ObsPlacementRef =
  | {
      readonly kind: "existing";
      readonly sceneUuid: string;
      readonly sceneItemId: number;
    }
  | {
      readonly kind: "created";
      readonly layerId: LayerId;
      readonly scene: ObsSceneRef;
    };

/** Non-destructive operation that creates a managed scene. */
export interface CreateSceneOperation extends ObsOperationBase {
  readonly kind: "create-scene";
  readonly phase: "scenes";
  readonly scene: ObsSceneRef;
  readonly sceneName: string;
}

/** Non-destructive operation that creates a managed input. */
export interface CreateInputOperation extends ObsOperationBase {
  readonly kind: "create-input";
  readonly phase: "inputs";
  readonly sourceId: SourceId;
  readonly inputName: string;
  readonly inputKind: string;
  readonly inputSettings: ObsJsonObject;
}

/** Non-destructive operation that places content in a scene. */
export interface CreatePlacementOperation extends ObsOperationBase {
  readonly kind: "create-placement";
  readonly phase: "placements";
  readonly layerId: LayerId;
  readonly scene: ObsSceneRef;
  readonly content: ObsContentRef;
}

/** Operation that converges an input's complete settings. */
export interface SetInputSettingsOperation extends ObsOperationBase {
  readonly kind: "set-input-settings";
  readonly phase: "settings";
  readonly sourceId: SourceId;
  readonly inputSettings: ObsJsonObject;
}

/** Operation that converges scene-item geometry. */
export interface SetTransformOperation extends ObsOperationBase {
  readonly kind: "set-transform";
  readonly phase: "transforms";
  readonly placement: ObsPlacementRef;
  readonly transform: ObsSceneItemTransform;
}

/** Operation that converges scene-item stacking order. */
export interface SetOrderOperation extends ObsOperationBase {
  readonly kind: "set-order";
  readonly phase: "ordering";
  readonly placement: ObsPlacementRef;
  readonly sceneItemIndex: number;
}

/** Operation that converges scene-item visibility. */
export interface SetEnabledOperation extends ObsOperationBase {
  readonly kind: "set-enabled";
  readonly phase: "enable";
  readonly placement: ObsPlacementRef;
  readonly enabled: boolean;
}

/** Destructive operation that removes an obsolete placement. */
export interface RemovePlacementOperation extends ObsOperationBase {
  readonly kind: "remove-placement";
  readonly phase: "remove-placements";
  readonly sceneUuid: string;
  readonly sceneItemId: number;
}

/** Destructive operation that removes an obsolete managed scene. */
export interface RemoveSceneOperation extends ObsOperationBase {
  readonly kind: "remove-scene";
  readonly phase: "remove-scenes";
  readonly sceneUuid: string;
}

/** Destructive operation that removes an obsolete managed input. */
export interface RemoveInputOperation extends ObsOperationBase {
  readonly kind: "remove-input";
  readonly phase: "remove-inputs";
  readonly inputUuid: string;
}

/** Closed union of operations emitted by the OBS planner. */
export type ObsOperation =
  | CreateSceneOperation
  | CreateInputOperation
  | CreatePlacementOperation
  | SetInputSettingsOperation
  | SetTransformOperation
  | SetOrderOperation
  | SetEnabledOperation
  | RemovePlacementOperation
  | RemoveSceneOperation
  | RemoveInputOperation;

/** Pure dependency-aware operation plan for one desired revision. */
export interface ObsPlan {
  readonly revision: number;
  readonly observationEpoch: number;
  readonly operations: readonly ObsOperation[];
}

/** OBS execution phases in required order. */
export const OBS_PHASES: readonly ObsPlanPhase[] = [
  "scenes",
  "inputs",
  "placements",
  "settings",
  "transforms",
  "ordering",
  "enable",
  "remove-placements",
  "remove-scenes",
  "remove-inputs",
];

/** Selects operations belonging to one execution phase. */
export function operationsInPhase(plan: ObsPlan, phase: ObsPlanPhase): readonly ObsOperation[] {
  return plan.operations.filter((operation) => operation.phase === phase);
}

/** Reports duplicate, missing, forward, or cyclic operation dependencies. */
export function validateOperationDependencies(
  operations: readonly ObsOperation[],
): readonly string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  const phaseIndex = new Map(OBS_PHASES.map((phase, index) => [phase, index]));
  const operationIndex = new Map(operations.map((operation, index) => [operation.key, index]));

  for (const operation of operations) {
    if (keys.has(operation.key)) errors.push(`Duplicate operation key '${operation.key}'.`);
    keys.add(operation.key);
  }

  const byKey = new Map(operations.map((operation) => [operation.key, operation]));
  for (const operation of operations) {
    for (const dependencyKey of operation.dependsOn) {
      const dependency = byKey.get(dependencyKey);
      if (dependency === undefined) {
        errors.push(`Operation '${operation.key}' depends on missing '${dependencyKey}'.`);
        continue;
      }
      const dependencyPhase = phaseIndex.get(dependency.phase) ?? -1;
      const operationPhase = phaseIndex.get(operation.phase) ?? -1;
      if (dependencyPhase > operationPhase) {
        errors.push(`Operation '${operation.key}' has a forward dependency on '${dependencyKey}'.`);
      } else if (
        dependencyPhase === operationPhase &&
        (operationIndex.get(dependencyKey) ?? Number.POSITIVE_INFINITY) >=
          (operationIndex.get(operation.key) ?? -1)
      ) {
        errors.push(
          `Operation '${operation.key}' has a same-phase forward dependency on '${dependencyKey}'.`,
        );
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles = new Set<string>();
  const visit = (key: string): void => {
    if (visited.has(key)) return;
    const operation = byKey.get(key);
    if (operation === undefined) return;
    visiting.add(key);
    for (const dependencyKey of operation.dependsOn) {
      if (visiting.has(dependencyKey)) {
        cycles.add(`Dependency cycle detected between '${key}' and '${dependencyKey}'.`);
      } else {
        visit(dependencyKey);
      }
    }
    visiting.delete(key);
    visited.add(key);
  };
  for (const operation of operations) visit(operation.key);

  return [...errors, ...cycles];
}
