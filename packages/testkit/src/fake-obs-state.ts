import type { ProjectId } from "@cbj/react-obs-core";
import {
  managedSceneName,
  managedSourceName,
  registrySceneName,
  type ObsContentRef,
  type ObsOperation,
  type ObsPlacementRef,
  type ObsPlan,
  type ObsSceneRef,
  type ObservedObsInput,
  type ObservedObsScene,
  type ObservedObsSceneItem,
  type ObservedObsState,
} from "@cbj/react-obs-target-obs";

export interface ApplyFakeObsPlanOptions {
  readonly state: ObservedObsState;
  readonly plan: ObsPlan;
  readonly projectId: ProjectId;
  /** Number of operations to confirm before simulating an interrupted execution. */
  readonly stopAfter?: number;
}

export interface FakeObsApplyResult {
  readonly state: ObservedObsState;
  readonly appliedOperationKeys: readonly string[];
  readonly complete: boolean;
}

interface PlacementAddress {
  readonly sceneUuid: string;
  readonly sceneItemId: number;
}

/**
 * Applies the symbolic plan like OBS would, using deterministic UUIDs. This is a
 * semantic reducer, not a protocol mock: it is intended for convergence and
 * partial-execution tests.
 */
export function applyFakeObsPlan(options: ApplyFakeObsPlanOptions): FakeObsApplyResult {
  const scenes = options.state.scenes.map((scene) => ({ ...scene }));
  const inputs = options.state.inputs.map((input) => ({ ...input }));
  const items = options.state.sceneItems.map((item) => ({ ...item }));
  const createdPlacements = new Map<string, PlacementAddress>();
  const applied: string[] = [];
  const limit = Math.max(
    0,
    Math.min(options.stopAfter ?? options.plan.operations.length, options.plan.operations.length),
  );
  let nextSceneItemId = Math.max(0, ...items.map((item) => item.sceneItemId)) + 1;

  for (const operation of options.plan.operations.slice(0, limit)) {
    applyOperation(
      operation,
      options.projectId,
      scenes,
      inputs,
      items,
      createdPlacements,
      () => nextSceneItemId++,
    );
    applied.push(operation.key);
  }

  normalizeSceneIndices(scenes);
  normalizeItemIndices(items);
  return {
    state: {
      observationEpoch: options.state.observationEpoch,
      capabilities: options.state.capabilities,
      scenes,
      inputs,
      sceneItems: items,
    },
    appliedOperationKeys: applied,
    complete: limit === options.plan.operations.length,
  };
}

function applyOperation(
  operation: ObsOperation,
  projectId: ProjectId,
  scenes: ObservedObsScene[],
  inputs: ObservedObsInput[],
  items: ObservedObsSceneItem[],
  createdPlacements: Map<string, PlacementAddress>,
  allocateSceneItemId: () => number,
): void {
  switch (operation.kind) {
    case "create-scene":
      scenes.push({
        sceneName: operation.sceneName,
        sceneUuid: deterministicUuid("scene", operation.sceneName),
        sceneIndex: scenes.length,
      });
      return;
    case "create-input": {
      const inputUuid = deterministicUuid("input", operation.inputName);
      inputs.push({
        inputName: operation.inputName,
        inputUuid,
        inputKind: operation.inputKind,
        inputSettings: operation.inputSettings,
      });
      const registry = requireSceneByName(scenes, registrySceneName(projectId));
      items.push({
        sceneUuid: registry.sceneUuid,
        sceneItemId: allocateSceneItemId(),
        sceneItemIndex: itemsForScene(items, registry.sceneUuid).length,
        sourceName: operation.inputName,
        sourceUuid: inputUuid,
        sceneItemEnabled: false,
      });
      return;
    }
    case "create-placement": {
      const scene = resolveScene(operation.scene, projectId, scenes);
      const source = resolveContent(operation.content, projectId, scenes, inputs);
      const address = {
        sceneUuid: scene.sceneUuid,
        sceneItemId: allocateSceneItemId(),
      };
      items.push({
        ...address,
        sceneItemIndex: itemsForScene(items, scene.sceneUuid).length,
        sourceName: source.name,
        sourceUuid: source.uuid,
        sceneItemEnabled: false,
      });
      createdPlacements.set(placementKey(operation.scene, operation.layerId), address);
      return;
    }
    case "set-input-settings": {
      const name = managedSourceName(projectId, operation.sourceId);
      const index = inputs.findIndex((input) => input.inputName === name);
      if (index < 0) throw new Error(`Fake OBS input '${name}' does not exist.`);
      const input = inputs[index];
      if (input === undefined) throw new Error(`Fake OBS input '${name}' disappeared.`);
      inputs[index] = { ...input, inputSettings: operation.inputSettings };
      return;
    }
    case "set-transform":
      updateItem(items, resolvePlacement(operation.placement, createdPlacements), (item) => ({
        ...item,
        sceneItemTransform: operation.transform,
      }));
      return;
    case "set-order": {
      const address = resolvePlacement(operation.placement, createdPlacements);
      const sceneItems = itemsForScene(items, address.sceneUuid);
      const moved = sceneItems.find((item) => item.sceneItemId === address.sceneItemId);
      if (moved === undefined) throw new Error("Fake OBS placement does not exist.");
      const ordered = sceneItems.filter((item) => item !== moved);
      ordered.splice(Math.min(operation.sceneItemIndex, ordered.length), 0, moved);
      ordered.forEach((item, index) => {
        updateItem(items, addressFor(item), (current) => ({ ...current, sceneItemIndex: index }));
      });
      return;
    }
    case "set-enabled":
      updateItem(items, resolvePlacement(operation.placement, createdPlacements), (item) => ({
        ...item,
        sceneItemEnabled: operation.enabled,
      }));
      return;
    case "remove-placement":
      removeWhere(
        items,
        (item) =>
          item.sceneUuid === operation.sceneUuid && item.sceneItemId === operation.sceneItemId,
      );
      return;
    case "remove-scene":
      removeWhere(scenes, (scene) => scene.sceneUuid === operation.sceneUuid);
      removeWhere(
        items,
        (item) => item.sceneUuid === operation.sceneUuid || item.sourceUuid === operation.sceneUuid,
      );
      return;
    case "remove-input":
      removeWhere(inputs, (input) => input.inputUuid === operation.inputUuid);
      removeWhere(items, (item) => item.sourceUuid === operation.inputUuid);
      return;
  }
}

function resolveScene(
  ref: ObsSceneRef,
  projectId: ProjectId,
  scenes: readonly ObservedObsScene[],
): ObservedObsScene {
  const name =
    ref.kind === "registry"
      ? registrySceneName(projectId)
      : managedSceneName(projectId, ref.sceneId);
  return requireSceneByName(scenes, name);
}

function resolveContent(
  ref: ObsContentRef,
  projectId: ProjectId,
  scenes: readonly ObservedObsScene[],
  inputs: readonly ObservedObsInput[],
): { readonly name: string; readonly uuid: string } {
  if (ref.kind === "scene") {
    const scene = requireSceneByName(scenes, managedSceneName(projectId, ref.sceneId));
    return { name: scene.sceneName, uuid: scene.sceneUuid };
  }
  const name = managedSourceName(projectId, ref.sourceId);
  const input = inputs.find((candidate) => candidate.inputName === name);
  if (input === undefined) throw new Error(`Fake OBS input '${name}' does not exist.`);
  return { name, uuid: input.inputUuid };
}

function resolvePlacement(
  ref: ObsPlacementRef,
  created: ReadonlyMap<string, PlacementAddress>,
): PlacementAddress {
  if (ref.kind === "existing") {
    return { sceneUuid: ref.sceneUuid, sceneItemId: ref.sceneItemId };
  }
  const result = created.get(placementKey(ref.scene, ref.layerId));
  if (result === undefined) throw new Error(`Fake OBS placement '${ref.layerId}' was not created.`);
  return result;
}

function updateItem(
  items: ObservedObsSceneItem[],
  address: PlacementAddress,
  update: (item: ObservedObsSceneItem) => ObservedObsSceneItem,
): void {
  const index = items.findIndex(
    (item) => item.sceneUuid === address.sceneUuid && item.sceneItemId === address.sceneItemId,
  );
  const item = items[index];
  if (index < 0 || item === undefined) throw new Error("Fake OBS placement does not exist.");
  items[index] = update(item);
}

function itemsForScene(
  items: readonly ObservedObsSceneItem[],
  sceneUuid: string,
): ObservedObsSceneItem[] {
  return items
    .filter((item) => item.sceneUuid === sceneUuid)
    .sort((left, right) => left.sceneItemIndex - right.sceneItemIndex);
}

function requireSceneByName(scenes: readonly ObservedObsScene[], name: string): ObservedObsScene {
  const scene = scenes.find((candidate) => candidate.sceneName === name);
  if (scene === undefined) throw new Error(`Fake OBS scene '${name}' does not exist.`);
  return scene;
}

function normalizeSceneIndices(scenes: ObservedObsScene[]): void {
  scenes.sort((left, right) => left.sceneIndex - right.sceneIndex);
  scenes.forEach((scene, index) => {
    scenes[index] = { ...scene, sceneIndex: index };
  });
}

function normalizeItemIndices(items: ObservedObsSceneItem[]): void {
  const sceneUuids = new Set(items.map((item) => item.sceneUuid));
  for (const sceneUuid of sceneUuids) {
    itemsForScene(items, sceneUuid).forEach((item, index) => {
      updateItem(items, addressFor(item), (current) => ({ ...current, sceneItemIndex: index }));
    });
  }
  items.sort((left, right) =>
    left.sceneUuid === right.sceneUuid
      ? left.sceneItemIndex - right.sceneItemIndex
      : left.sceneUuid.localeCompare(right.sceneUuid),
  );
}

function addressFor(item: ObservedObsSceneItem): PlacementAddress {
  return { sceneUuid: item.sceneUuid, sceneItemId: item.sceneItemId };
}

function placementKey(scene: ObsSceneRef, layerId: string): string {
  return `${scene.kind === "registry" ? "registry" : scene.sceneId}:${layerId}`;
}

function deterministicUuid(kind: "scene" | "input", name: string): string {
  return `fake-${kind}:${name}`;
}

function removeWhere<T>(values: T[], predicate: (value: T) => boolean): void {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value !== undefined && predicate(value)) values.splice(index, 1);
  }
}
