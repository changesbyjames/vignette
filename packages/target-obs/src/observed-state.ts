import { omitUndefined } from "@strangecyan/vignette-core";

import { parseManagedName } from "./naming.js";
import type { ObsJsonObject, ObsSceneItemTransform } from "./operations.js";

interface ManagedObservedIndexDuplicatePlacements {
  readonly sceneUuid: string;
  readonly sourceUuid: string;
  readonly sceneItemIds: readonly number[];
}

/** Protocol, request, input-kind, and platform capabilities reported by OBS. */
export interface ObsProtocolCapabilities {
  readonly obsVersion: string;
  readonly obsWebSocketVersion: string;
  readonly rpcVersion: number;
  readonly availableRequests: readonly string[];
  readonly inputKinds: readonly string[];
  readonly platform: string;
}

/** Scene observed during an authoritative OBS bootstrap. */
export interface ObservedObsScene {
  readonly sceneName: string;
  readonly sceneUuid: string;
  readonly sceneIndex: number;
  readonly canvasUuid?: string;
}

/** Input observed during an authoritative OBS bootstrap. */
export interface ObservedObsInput {
  readonly inputName: string;
  readonly inputUuid: string;
  readonly inputKind: string;
  readonly inputSettings: ObsJsonObject;
}

/** Scene-item placement observed during an authoritative OBS bootstrap. */
export interface ObservedObsSceneItem {
  readonly sceneUuid: string;
  readonly sceneItemId: number;
  readonly sceneItemIndex: number;
  readonly sourceName: string;
  readonly sourceUuid: string;
  readonly sceneItemEnabled: boolean;
  readonly sceneItemTransform?: ObsSceneItemTransform;
}

/** Complete authoritative OBS state used by the pure planner. */
export interface ObservedObsState {
  readonly observationEpoch: number;
  readonly capabilities: ObsProtocolCapabilities;
  readonly scenes: readonly ObservedObsScene[];
  readonly inputs: readonly ObservedObsInput[];
  readonly sceneItems: readonly ObservedObsSceneItem[];
}

/** Managed subset of observed OBS state indexed by Vignette IDs. */
export interface ManagedObservedIndex {
  readonly registry?: ObservedObsScene;
  readonly scenes: ReadonlyMap<string, ObservedObsScene>;
  readonly inputs: ReadonlyMap<string, ObservedObsInput>;
  readonly itemsByScene: ReadonlyMap<string, readonly ObservedObsSceneItem[]>;
  readonly duplicatePlacements: readonly ManagedObservedIndexDuplicatePlacements[];
}

/** Indexes only resources belonging to a managed project namespace. */
export function indexManagedObservedState(
  state: ObservedObsState,
  project: string,
): ManagedObservedIndex {
  let registry: ObservedObsScene | undefined = undefined;
  const scenes = new Map<string, ObservedObsScene>();
  const itemsByScene = new Map<string, ObservedObsSceneItem[]>();

  for (const scene of state.scenes) {
    // Accept only scene names in this project namespace and distinguish the registry from named scenes.

    const managed = parseManagedName(scene.sceneName);
    if (managed?.projectId !== project) continue;
    if (managed.kind === "registry") registry = scene;
    if (managed.kind === "scene") scenes.set(managed.sceneId, scene);
  }

  const inputs = indexManagedInputs(state.inputs, project);

  const managedSceneUuids = new Set([
    ...(registry === undefined ? [] : [registry.sceneUuid]),
    ...[...scenes.values()].map((scene) => scene.sceneUuid),
  ]);
  for (const item of state.sceneItems) {
    if (!managedSceneUuids.has(item.sceneUuid)) continue;
    const current = itemsByScene.get(item.sceneUuid) ?? [];
    current.push(item);
    itemsByScene.set(item.sceneUuid, current);
  }

  const duplicatePlacements = findDuplicatePlacements(itemsByScene);

  return {
    ...omitUndefined({ registry: registry }),
    scenes,
    inputs,
    itemsByScene,
    duplicatePlacements,
  };
}

/** Group placements per source while keeping each scene in observed stacking order. */
function findDuplicatePlacements(
  itemsByScene: Map<string, ObservedObsSceneItem[]>,
): ManagedObservedIndex["duplicatePlacements"] {
  const duplicatePlacements: ManagedObservedIndex["duplicatePlacements"][number][] = [];
  for (const [sceneUuid, items] of itemsByScene) {
    // Group item IDs by source within each scene and preserve observed stacking order for planning.

    const bySource = new Map<string, number[]>();
    for (const item of items) {
      const ids = bySource.get(item.sourceUuid) ?? [];
      ids.push(item.sceneItemId);
      bySource.set(item.sourceUuid, ids);
    }
    for (const [sourceUuid, sceneItemIds] of bySource) {
      if (sceneItemIds.length > 1)
        duplicatePlacements.push({ sceneUuid, sourceUuid, sceneItemIds });
    }
    items.sort((left, right) => left.sceneItemIndex - right.sceneItemIndex);
  }

  return duplicatePlacements;
}

/** Foreign and non-source names never enter the managed input index. */
function indexManagedInputs(
  observed: readonly ObservedObsInput[],
  project: string,
): Map<string, ObservedObsInput> {
  const inputs = new Map<string, ObservedObsInput>();
  for (const input of observed) {
    const managed = parseManagedName(input.inputName);
    if (managed?.kind === "source" && managed.projectId === project) {
      inputs.set(managed.sourceId, input);
    }
  }

  return inputs;
}
