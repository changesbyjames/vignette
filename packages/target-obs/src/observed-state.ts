import type { ProjectId, SceneId, SourceId } from "@cbj/react-obs-core";

import { parseManagedName } from "./naming.js";
import type { ObsJsonObject, ObsSceneItemTransform } from "./operations.js";

export interface ObsProtocolCapabilities {
  readonly obsVersion: string;
  readonly obsWebSocketVersion: string;
  readonly rpcVersion: number;
  readonly availableRequests: readonly string[];
  readonly inputKinds: readonly string[];
  readonly platform: string;
}

export interface ObservedObsScene {
  readonly sceneName: string;
  readonly sceneUuid: string;
  readonly sceneIndex: number;
  readonly canvasUuid?: string;
}

export interface ObservedObsInput {
  readonly inputName: string;
  readonly inputUuid: string;
  readonly inputKind: string;
  readonly inputSettings: ObsJsonObject;
}

export interface ObservedObsSceneItem {
  readonly sceneUuid: string;
  readonly sceneItemId: number;
  readonly sceneItemIndex: number;
  readonly sourceName: string;
  readonly sourceUuid: string;
  readonly sceneItemEnabled: boolean;
  readonly sceneItemTransform?: ObsSceneItemTransform;
}

export interface ObservedObsState {
  readonly observationEpoch: number;
  readonly capabilities: ObsProtocolCapabilities;
  readonly scenes: readonly ObservedObsScene[];
  readonly inputs: readonly ObservedObsInput[];
  readonly sceneItems: readonly ObservedObsSceneItem[];
}

export interface ManagedObservedIndex {
  readonly registry?: ObservedObsScene;
  readonly scenes: ReadonlyMap<SceneId, ObservedObsScene>;
  readonly inputs: ReadonlyMap<SourceId, ObservedObsInput>;
  readonly itemsByScene: ReadonlyMap<string, readonly ObservedObsSceneItem[]>;
  readonly duplicatePlacements: readonly {
    readonly sceneUuid: string;
    readonly sourceUuid: string;
    readonly sceneItemIds: readonly number[];
  }[];
}

export function indexManagedObservedState(
  state: ObservedObsState,
  project: ProjectId,
): ManagedObservedIndex {
  let registry: ObservedObsScene | undefined;
  const scenes = new Map<SceneId, ObservedObsScene>();
  const inputs = new Map<SourceId, ObservedObsInput>();
  const itemsByScene = new Map<string, ObservedObsSceneItem[]>();

  for (const scene of state.scenes) {
    const managed = parseManagedName(scene.sceneName);
    if (managed?.projectId !== project) continue;
    if (managed.kind === "registry") registry = scene;
    if (managed.kind === "scene") scenes.set(managed.sceneId, scene);
  }

  for (const input of state.inputs) {
    const managed = parseManagedName(input.inputName);
    if (managed?.kind === "source" && managed.projectId === project) {
      inputs.set(managed.sourceId, input);
    }
  }

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

  const duplicatePlacements: ManagedObservedIndex["duplicatePlacements"][number][] = [];
  for (const [sceneUuid, items] of itemsByScene) {
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

  return {
    ...(registry === undefined ? {} : { registry }),
    scenes,
    inputs,
    itemsByScene,
    duplicatePlacements,
  };
}
