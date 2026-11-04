import { parseManagedName } from "./naming.js";
import type { ObsJsonObject, ObsSceneItemTransform } from "./operations.js";

/** Scene observed in OBS. */
export interface ObservedObsScene {
  readonly sceneName: string;
  readonly sceneUuid: string;
}

/** Managed input observed in OBS. `inputMuted` is absent for inputs without audio. */
export interface ObservedObsInput {
  readonly inputName: string;
  readonly inputUuid: string;
  readonly inputKind: string;
  readonly inputSettings: ObsJsonObject;
  readonly inputMuted?: boolean;
}

/** Scene item observed in a managed scene. */
export interface ObservedObsSceneItem {
  readonly sceneUuid: string;
  readonly sceneItemId: number;
  readonly sceneItemIndex: number;
  readonly sourceName: string;
  readonly sourceUuid: string;
  readonly sceneItemEnabled: boolean;
  readonly sceneItemTransform?: ObsSceneItemTransform;
}

/**
 * One authoritative read of OBS for one show: every scene (names only matter for managed ones),
 * the show's managed inputs, the items of its managed scenes, and the program scene.
 */
export interface ObservedObsState {
  readonly show: string;
  /** Input kinds this OBS advertises. */
  readonly inputKinds: readonly string[];
  /** Requests convergence needs that this OBS does not advertise; non-empty blocks planning. */
  readonly missingRequests: readonly string[];
  /** Name of the current program scene, managed or not. */
  readonly programSceneName?: string;
  readonly scenes: readonly ObservedObsScene[];
  readonly inputs: readonly ObservedObsInput[];
  readonly sceneItems: readonly ObservedObsSceneItem[];
}

/** One source placed more than once in one managed scene, which makes its items ambiguous. */
export interface DuplicatePlacement {
  readonly sceneUuid: string;
  readonly sourceUuid: string;
  readonly sceneItemIds: readonly number[];
}

/** The managed subset of observed state, indexed by show scene and source IDs. */
export interface ManagedObservedIndex {
  readonly registry?: ObservedObsScene;
  readonly scenes: ReadonlyMap<string, ObservedObsScene>;
  readonly inputs: ReadonlyMap<string, ObservedObsInput>;
  /** Items of each managed scene (registry included) by scene UUID, in stacking order. */
  readonly itemsByScene: ReadonlyMap<string, readonly ObservedObsSceneItem[]>;
  readonly duplicatePlacements: readonly DuplicatePlacement[];
}

/** Indexes only resources in the observed show's namespace; everything else is invisible. */
export function indexManagedObservedState(state: ObservedObsState): ManagedObservedIndex {
  let registry: ObservedObsScene | undefined = undefined;
  const scenes = new Map<string, ObservedObsScene>();
  for (const scene of state.scenes) {
    const managed = parseManagedName(scene.sceneName, state.show);
    if (managed === undefined) continue;
    if (managed.id === undefined) registry = scene;
    else scenes.set(managed.id, scene);
  }
  const itemsByScene = itemsOf(state, [registry, ...scenes.values()]);
  return {
    registry,
    scenes,
    inputs: inputsOf(state),
    itemsByScene,
    duplicatePlacements: duplicates(itemsByScene),
  };
}

/** The show's inputs by source ID. */
function inputsOf(state: ObservedObsState): ReadonlyMap<string, ObservedObsInput> {
  const inputs = new Map<string, ObservedObsInput>();
  for (const input of state.inputs) {
    const id = parseManagedName(input.inputName, state.show)?.id;
    if (id !== undefined) inputs.set(id, input);
  }
  return inputs;
}

/** Items of the given managed scenes by scene UUID, each list in stacking order. */
function itemsOf(
  state: ObservedObsState,
  managedScenes: readonly (ObservedObsScene | undefined)[],
): ReadonlyMap<string, readonly ObservedObsSceneItem[]> {
  const managedSceneUuids = new Set(
    managedScenes.flatMap((scene) => (scene === undefined ? [] : [scene.sceneUuid])),
  );
  const itemsByScene = new Map<string, ObservedObsSceneItem[]>();
  for (const item of state.sceneItems) {
    if (!managedSceneUuids.has(item.sceneUuid)) continue;
    const current = itemsByScene.get(item.sceneUuid) ?? [];
    current.push(item);
    itemsByScene.set(item.sceneUuid, current);
  }
  for (const items of itemsByScene.values()) {
    items.sort((left, right) => left.sceneItemIndex - right.sceneItemIndex);
  }
  return itemsByScene;
}

/** Groups each scene's items by source and reports sources placed more than once. */
function duplicates(
  itemsByScene: ReadonlyMap<string, readonly ObservedObsSceneItem[]>,
): readonly DuplicatePlacement[] {
  const found: DuplicatePlacement[] = [];
  for (const [sceneUuid, items] of itemsByScene) {
    // Group the scene's item IDs by the source they show; more than one is a duplicate.
    const bySource = new Map<string, number[]>();
    for (const item of items) {
      const ids = bySource.get(item.sourceUuid) ?? [];
      ids.push(item.sceneItemId);
      bySource.set(item.sourceUuid, ids);
    }
    for (const [sourceUuid, sceneItemIds] of bySource) {
      if (sceneItemIds.length > 1) found.push({ sceneUuid, sourceUuid, sceneItemIds });
    }
  }
  return found;
}
