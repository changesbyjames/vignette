import { intersectRects, type Size } from "../core/geometry.js";
import type { Item, Snapshot, SnapshotScene, Source } from "../core/snapshot.js";
import {
  managedSceneName,
  managedSourceName,
  parseManagedName,
  registrySceneName,
} from "./naming.js";
import {
  indexManagedObservedState,
  type ManagedObservedIndex,
  type ObservedObsInput,
  type ObservedObsScene,
  type ObservedObsSceneItem,
  type ObservedObsState,
} from "./observed-state.js";
import {
  validateOperationDependencies,
  type ObsJsonObject,
  type ObsJsonValue,
  type ObsOperation,
  type ObsPlacementRef,
  type ObsPlan,
  type ObsSceneItemTransform,
} from "./operations.js";
import type { ObsHandle } from "./plugin.js";

/** What the planner converges: the desired snapshot against one observation of OBS. */
export interface ObsPlannerInput {
  readonly desired: Snapshot;
  readonly observed: ObservedObsState;
  /**
   * Live plugin handles by source ID; each says which input its source becomes. A source without
   * one is still preparing (or failed): its existing input and items are left as they are.
   */
  readonly handles: ReadonlyMap<string, ObsHandle>;
  /**
   * The `activeScene` of the last snapshot this target settled. The program scene is set only
   * when `activeScene` differs from it, so a re-observation never fights an operator's switch.
   */
  readonly settledActiveScene?: string;
  /** Layer kinds this target has a plugin for; their items are handed over, not transformed. */
  readonly layers?: ReadonlySet<string>;
  /** The item each handed-over placement (`scene:layer`) was last placed with. */
  readonly placed?: ReadonlyMap<string, Item>;
  /** Handed-over placements whose plugin is still releasing them: left alone until removed. */
  readonly leaving?: ReadonlySet<string>;
  /** The last snapshot this target settled, which still describes the items it is removing. */
  readonly previous?: Snapshot;
}

/** A plan, or the problems that make the snapshot unsafe to converge. */
export type ObsPlanResult = ObsPlanSuccess | ObsPlanFailure;

/** The snapshot can be converged by executing `plan`. */
export interface ObsPlanSuccess {
  readonly ok: true;
  readonly plan: ObsPlan;
}

/** The snapshot cannot be converged safely; nothing was planned. */
export interface ObsPlanFailure {
  readonly ok: false;
  readonly problems: readonly string[];
}

/** Everything the planning steps share. */
interface Planning {
  readonly input: ObsPlannerInput;
  readonly show: string;
  readonly managed: ManagedObservedIndex;
  readonly sources: ReadonlyMap<string, Source>;
  readonly operations: ObsOperation[];
  readonly problems: string[];
  /** Create keys by scene ID, for scenes created by this plan. */
  readonly sceneCreates: Map<string, string>;
  /** Create keys by source ID, for inputs created by this plan. */
  readonly inputCreates: Map<string, string>;
  /** Observed items that a desired layer still places, as `sceneUuid:sceneItemId`. */
  readonly matched: Set<string>;
  registryCreate?: string;
}

/**
 * Purely turns desired and observed state into a dependency-ordered plan: create the registry,
 * scenes and inputs, place and transform items, set the program scene, then remove what is gone.
 * Only resources in `vignette/<show>` are ever addressed.
 */
export function planObsUpdate(input: ObsPlannerInput): ObsPlanResult {
  const planning: Planning = {
    input,
    show: input.desired.id,
    managed: indexManagedObservedState(input.observed),
    sources: new Map(input.desired.sources.map((source) => [source.id, source])),
    operations: [],
    problems: [],
    sceneCreates: new Map(),
    inputCreates: new Map(),
    matched: new Set(),
  };
  checkPreconditions(planning);
  planScenes(planning);
  for (const source of input.desired.sources) planInput(planning, source);
  for (const scene of input.desired.scenes) planSceneItems(planning, scene);
  planProgramScene(planning);
  if (planning.managed.duplicatePlacements.length === 0) prune(planning);
  planning.problems.push(...validateOperationDependencies(planning.operations));
  if (planning.problems.length > 0) return { ok: false, problems: planning.problems };
  return {
    ok: true,
    plan: {
      show: planning.show,
      revision: input.desired.revision,
      operations: planning.operations,
    },
  };
}

/** Requests OBS lacks, a foreign observation, name collisions and ambiguous items block a plan. */
function checkPreconditions(planning: Planning): void {
  const { input, problems, managed } = planning;
  for (const request of input.observed.missingRequests) {
    problems.push(`OBS does not expose required request '${request}'.`);
  }
  if (input.observed.show !== planning.show) {
    problems.push(
      `Observed OBS state is for show '${input.observed.show}', not '${planning.show}'.`,
    );
  }
  // Scenes and inputs share one name space in OBS, so a scene and a source may not share an ID.
  for (const scene of input.desired.scenes) {
    if (planning.sources.has(scene.id)) {
      problems.push(
        `Scene '${scene.id}' and source '${scene.id}' would both be named '${managedSceneName(planning.show, scene.id)}' in OBS.`,
      );
    }
  }
  for (const duplicate of managed.duplicatePlacements) {
    problems.push(
      `OBS places source '${duplicate.sourceUuid}' more than once in managed scene '${duplicate.sceneUuid}' (items ${duplicate.sceneItemIds.join(", ")}); remove the extra items.`,
    );
  }
}

/** Creates the registry scene and every desired scene OBS lacks. */
function planScenes(planning: Planning): void {
  if (planning.managed.registry === undefined) {
    planning.registryCreate = "scene:create:registry";
    planning.operations.push({
      kind: "create-scene",
      key: planning.registryCreate,
      phase: "scenes",
      dependsOn: [],
      destructive: false,
      sceneName: registrySceneName(planning.show),
    });
  }
  for (const scene of planning.input.desired.scenes) {
    if (planning.managed.scenes.has(scene.id)) continue;
    const key = `scene:create:${scene.id}`;
    planning.sceneCreates.set(scene.id, key);
    planning.operations.push({
      kind: "create-scene",
      key,
      phase: "scenes",
      dependsOn: [],
      destructive: false,
      sceneName: managedSceneName(planning.show, scene.id),
    });
  }
}

/**
 * Creates the source's input, or converges its settings and mute state. A source without a live
 * handle keeps whatever input it has. An input of the wrong kind is a problem: replacing it would
 * lose the filters an operator added.
 */
function planInput(planning: Planning, source: Source): void {
  const handle = planning.input.handles.get(source.id);
  if (handle === undefined) return;
  const { kind, settings, muted } = handle.input;
  if (!planning.input.observed.inputKinds.includes(kind)) {
    planning.problems.push(`OBS has no input kind '${kind}' for source '${source.id}'.`);
    return;
  }
  const observed = planning.managed.inputs.get(source.id);
  if (observed !== undefined && observed.inputKind !== kind) {
    planning.problems.push(
      `Input '${observed.inputName}' is a '${observed.inputKind}', but source '${source.id}' needs a '${kind}'. Remove it in OBS to let it be recreated.`,
    );
    return;
  }
  if (observed === undefined) {
    const key = `input:create:${source.id}`;
    planning.inputCreates.set(source.id, key);
    planning.operations.push({
      kind: "create-input",
      key,
      phase: "inputs",
      dependsOn: planning.registryCreate === undefined ? [] : [planning.registryCreate],
      destructive: false,
      sourceId: source.id,
      inputName: managedSourceName(planning.show, source.id),
      inputKind: kind,
      inputSettings: settings,
    });
  } else if (!objectContains(observed.inputSettings, settings)) {
    planning.operations.push({
      kind: "set-input-settings",
      key: `input:settings:${source.id}`,
      phase: "settings",
      dependsOn: [],
      destructive: false,
      sourceId: source.id,
      inputSettings: settings,
    });
  }
  planMute(planning, source.id, observed, muted);
}

/** Mutes or unmutes the input when its handle asks for a state OBS does not have. */
function planMute(
  planning: Planning,
  sourceId: string,
  observed: ObservedObsInput | undefined,
  muted: boolean | undefined,
): void {
  if (muted === undefined || observed?.inputMuted === muted) return;
  const create = planning.inputCreates.get(sourceId);
  planning.operations.push({
    kind: "set-input-mute",
    key: `input:mute:${sourceId}`,
    phase: "settings",
    dependsOn: create === undefined ? [] : [create],
    destructive: false,
    sourceId,
    muted,
  });
}

/** One desired item as it will exist after the plan's placements phase. */
interface PresentItem {
  readonly item: Item;
  readonly placement: ObsPlacementRef;
  readonly dependsOn: readonly string[];
  /** The observed item's index; undefined for an item this plan creates. */
  readonly observedIndex?: number;
}

/**
 * Matches each item to the one observed item of its source in the scene, or creates it, then
 * converges transforms, stacking order and visibility. Items of sources without a handle keep
 * their observed item untouched.
 */
function planSceneItems(planning: Planning, scene: SnapshotScene): void {
  const observedScene = planning.managed.scenes.get(scene.id);
  const present: PresentItem[] = [];
  for (const item of scene.items) {
    // Mark the observed item as still placed even when the source has no handle to converge it.
    const observedInput = planning.managed.inputs.get(item.sourceId);
    const observedItem = findObservedItem(planning.managed, observedScene, observedInput);
    if (observedScene !== undefined && observedItem !== undefined) {
      planning.matched.add(itemIdentity(observedScene.sceneUuid, observedItem.sceneItemId));
    }
    const source = planning.sources.get(item.sourceId);
    if (!planning.input.handles.has(item.sourceId) || source === undefined) continue;
    const entry =
      observedScene !== undefined && observedItem !== undefined
        ? existingItem(item, observedScene, observedItem)
        : createItem(planning, scene, item);
    present.push(entry);
    if (planning.input.layers?.has(item.kind)) planPlacement(planning, scene, entry);
    else planItemProperties(planning, scene, entry, source.size, observedItem);
  }
  planOrder(planning, scene, present);
}

function existingItem(
  item: Item,
  scene: ObservedObsScene,
  observed: ObservedObsSceneItem,
): PresentItem {
  return {
    item,
    placement: { kind: "existing", sceneUuid: scene.sceneUuid, sceneItemId: observed.sceneItemId },
    dependsOn: [],
    observedIndex: observed.sceneItemIndex,
  };
}

function createItem(planning: Planning, scene: SnapshotScene, item: Item): PresentItem {
  const key = `placement:create:${scene.id}:${item.id}`;
  const dependencies = [
    planning.sceneCreates.get(scene.id),
    planning.inputCreates.get(item.sourceId),
  ];
  planning.operations.push({
    kind: "create-placement",
    key,
    phase: "placements",
    dependsOn: dependencies.filter((dependency) => dependency !== undefined),
    destructive: false,
    sceneId: scene.id,
    layerId: item.id,
    sourceId: item.sourceId,
  });
  return {
    item,
    placement: { kind: "created", sceneId: scene.id, layerId: item.id },
    dependsOn: [key],
  };
}

/**
 * Hands an item of a layer kind to its plugin, once it exists and whenever it changes. The plugin
 * owns the item's transform and visibility, so neither is converged here, and a re-observation
 * that finds them changed plans nothing.
 */
function planPlacement(planning: Planning, scene: SnapshotScene, entry: PresentItem): void {
  const { item, placement, dependsOn } = entry;
  const key = placementKey(scene.id, item.id);
  const previous = planning.input.placed?.get(key);
  if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(item)) return;
  planning.operations.push({
    kind: "place-item",
    key: `placement:place:${scene.id}:${item.id}`,
    phase: "place",
    dependsOn,
    destructive: false,
    sceneId: scene.id,
    placement,
    item,
    previous,
  });
}

/** The key of a handed-over placement in `placed`: its scene and layer IDs. */
export function placementKey(sceneId: string, layerId: string): string {
  return `${sceneId}:${layerId}`;
}

/** Converges the item's transform and visibility; OBS items have no opacity, so it is ignored. */
function planItemProperties(
  planning: Planning,
  scene: SnapshotScene,
  entry: PresentItem,
  sourceSize: Size,
  observed: ObservedObsSceneItem | undefined,
): void {
  const { item, placement, dependsOn } = entry;
  const transform = toObsTransform(item, sourceSize);
  if (observed === undefined || !objectContains(observed.sceneItemTransform ?? {}, transform)) {
    planning.operations.push({
      kind: "set-transform",
      key: `placement:transform:${scene.id}:${item.id}`,
      phase: "transforms",
      dependsOn,
      destructive: false,
      placement,
      transform,
    });
  }
  // Created items start disabled, so a visible one is always enabled.
  if (observed === undefined ? item.visible : observed.sceneItemEnabled !== item.visible) {
    planning.operations.push({
      kind: "set-enabled",
      key: `placement:enabled:${scene.id}:${item.id}`,
      phase: "enable",
      dependsOn,
      destructive: false,
      placement,
      enabled: item.visible,
    });
  }
}

/**
 * Restacks the scene only when its items' relative order is wrong. New items are added on top in
 * desired order, so the order is right when observed indices increase and no observed item comes
 * after a new one. Restacking sets every item's index from the bottom up, which also puts the
 * show's items in order beneath anything an operator added to the scene.
 */
function planOrder(
  planning: Planning,
  scene: SnapshotScene,
  present: readonly PresentItem[],
): void {
  let previous = Number.NEGATIVE_INFINITY;
  let created = false;
  let ordered = true;
  for (const entry of present) {
    if (entry.observedIndex === undefined) {
      created = true;
    } else {
      ordered &&= !created && entry.observedIndex > previous;
      previous = entry.observedIndex;
    }
  }
  if (ordered) return;
  for (const [index, entry] of present.entries()) {
    planning.operations.push({
      kind: "set-order",
      key: `placement:order:${scene.id}:${entry.item.id}`,
      phase: "ordering",
      dependsOn: entry.dependsOn,
      destructive: false,
      placement: entry.placement,
      sceneItemIndex: index,
    });
  }
}

/** Sets the program scene when `activeScene` changed since the last settled snapshot. */
function planProgramScene(planning: Planning): void {
  const { desired, observed, settledActiveScene } = planning.input;
  const active = desired.activeScene;
  if (active === undefined || active === settledActiveScene) return;
  if (observed.programSceneName === managedSceneName(planning.show, active)) return;
  const create = planning.sceneCreates.get(active);
  planning.operations.push({
    kind: "set-program-scene",
    key: `program:${active}`,
    phase: "program",
    dependsOn: create === undefined ? [] : [create],
    destructive: false,
    sceneId: active,
  });
}

/** Reuses an observed item only when exactly one item of the input is in the scene. */
function findObservedItem(
  managed: ManagedObservedIndex,
  scene: ObservedObsScene | undefined,
  input: ObservedObsInput | undefined,
): ObservedObsSceneItem | undefined {
  if (scene === undefined || input === undefined) return undefined;
  const matches = (managed.itemsByScene.get(scene.sceneUuid) ?? []).filter(
    (item) => item.sourceUuid === input.inputUuid,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Removes what the snapshot no longer has: items of managed inputs no desired layer places,
 * registry items of removed inputs, removed scenes, then removed inputs once nothing places them.
 * Items an operator placed from outside the namespace are kept.
 */
function prune(planning: Planning): void {
  const { managed } = planning;
  const sourceIds = new Set(planning.sources.keys());
  const sceneIds = new Set(planning.input.desired.scenes.map((scene) => scene.id));
  const removals = pruneItems(planning, sourceIds, sceneIds);
  for (const [id, scene] of managed.scenes) {
    if (sceneIds.has(id)) continue;
    const key = `scene:remove:${id}`;
    removals.push(key);
    planning.operations.push({
      kind: "remove-scene",
      key,
      phase: "remove-scenes",
      dependsOn: [],
      destructive: true,
      sceneUuid: scene.sceneUuid,
    });
  }
  for (const [id, input] of managed.inputs) {
    if (sourceIds.has(id)) continue;
    planning.operations.push({
      kind: "remove-input",
      key: `input:remove:${id}`,
      phase: "remove-inputs",
      dependsOn: removals,
      destructive: true,
      inputUuid: input.inputUuid,
    });
  }
}

/**
 * Removes stale items from the registry and from scenes that stay, and returns their keys. A
 * registry item is stale when its input goes; a scene item when it shows a managed input or scene
 * that no desired layer places.
 */
function pruneItems(
  planning: Planning,
  sourceIds: ReadonlySet<string>,
  sceneIds: ReadonlySet<string>,
): string[] {
  const { managed, show } = planning;
  const removedInputs = new Set(
    [...managed.inputs].flatMap(([id, input]) => (sourceIds.has(id) ? [] : [input.inputUuid])),
  );
  const keptScenes = [
    ...(managed.registry === undefined ? [] : [managed.registry]),
    ...[...managed.scenes].flatMap(([id, scene]) => (sceneIds.has(id) ? [scene] : [])),
  ];
  const removals: string[] = [];
  const sceneIdOf = new Map([...managed.scenes].map(([id, scene]) => [scene.sceneUuid, id]));
  for (const scene of keptScenes) {
    // Registry items are stale with their input; scene items when no desired layer matched them.
    const stale = (item: ObservedObsSceneItem): boolean =>
      scene === managed.registry
        ? removedInputs.has(item.sourceUuid)
        : !planning.matched.has(itemIdentity(scene.sceneUuid, item.sceneItemId)) &&
          parseManagedName(item.sourceName, show) !== undefined;
    for (const item of (managed.itemsByScene.get(scene.sceneUuid) ?? []).filter(stale)) {
      // A handed-over item is released by its plugin (or left alone while leaving); others removed.
      const key = `placement:remove:${scene.sceneUuid}:${String(item.sceneItemId)}`;
      removals.push(key);
      const sceneId = sceneIdOf.get(scene.sceneUuid);
      const handed = sceneId === undefined ? undefined : handedOverItem(planning, sceneId, item);
      if (sceneId !== undefined && handed !== undefined) {
        // Its exit is playing; the plugin removes it when that ends, and a re-observation follows.
        if (planning.input.leaving?.has(placementKey(sceneId, handed.id))) continue;
        planning.operations.push({
          kind: "release-placement",
          key,
          phase: "release",
          dependsOn: [],
          destructive: true,
          sceneId,
          sceneUuid: scene.sceneUuid,
          sceneItemId: item.sceneItemId,
          item: handed,
        });
        continue;
      }
      planning.operations.push({
        kind: "remove-placement",
        key,
        phase: "remove-placements",
        dependsOn: [],
        destructive: true,
        sceneUuid: scene.sceneUuid,
        sceneItemId: item.sceneItemId,
      });
    }
  }
  return removals;
}

/**
 * The previous snapshot's item for a stale scene item, when its layer kind's plugin placed it: it
 * is released through the plugin (its exit plays) rather than removed outright. Every lookup can
 * miss: an unmanaged name, a scene or item the previous snapshot lacks, a kind without a plugin,
 * or an item never handed over; each means a plain removal.
 */
function handedOverItem(
  planning: Planning,
  sceneId: string,
  observed: ObservedObsSceneItem,
): Item | undefined {
  const sourceId = parseManagedName(observed.sourceName, planning.show)?.id;
  const scene = planning.input.previous?.scenes.find((candidate) => candidate.id === sceneId);
  const item = scene?.items.find((candidate) => candidate.sourceId === sourceId);
  if (item === undefined || !planning.input.layers?.has(item.kind)) return undefined;
  return isHandedOver(planning.input, placementKey(sceneId, item.id)) ? item : undefined;
}

/** Whether a placement is with its plugin: placed, or leaving (placed, now playing its exit). */
function isHandedOver(input: ObsPlannerInput, key: string): boolean {
  return input.placed?.has(key) === true || input.leaving?.has(key) === true;
}

/**
 * Converts compiled placement and clipping into OBS stretch bounds and source-pixel crop. A clip
 * (the canvas cutting the frame) shrinks the bounds and adds the cut part to the crop.
 */
export function toObsTransform(item: Item, sourceSize: Size): ObsSceneItemTransform {
  const { destination, sourceCrop } = item.placement;
  const visible =
    item.clip === undefined ? destination : (intersectRects(destination, item.clip) ?? destination);
  const scaleX = destination.width / (sourceSize.width - sourceCrop.left - sourceCrop.right);
  const scaleY = destination.height / (sourceSize.height - sourceCrop.top - sourceCrop.bottom);
  return {
    positionX: visible.x,
    positionY: visible.y,
    rotation: item.rotation,
    alignment: 5,
    boundsType: "OBS_BOUNDS_STRETCH",
    boundsAlignment: 5,
    boundsWidth: visible.width,
    boundsHeight: visible.height,
    cropTop: round(sourceCrop.top + (visible.y - destination.y) / scaleY),
    cropRight: round(
      sourceCrop.right + (destination.x + destination.width - visible.x - visible.width) / scaleX,
    ),
    cropBottom: round(
      sourceCrop.bottom +
        (destination.y + destination.height - visible.y - visible.height) / scaleY,
    ),
    cropLeft: round(sourceCrop.left + (visible.x - destination.x) / scaleX),
  };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Whether `observed` already satisfies `desired`, treating objects as recursive subsets. */
function objectContains(observed: ObsJsonObject, desired: ObsJsonObject): boolean {
  return Object.entries(desired).every(([key, value]) => containsValue(observed[key], value));
}

/** Objects match recursively as subsets; arrays need equal length and matching elements. */
function containsValue(observed: ObsJsonValue | undefined, desired: ObsJsonValue): boolean {
  if (isRecord(observed) && isRecord(desired)) return objectContains(observed, desired);
  if (Array.isArray(observed) && Array.isArray(desired)) {
    const values: readonly ObsJsonValue[] = observed;
    return (
      values.length === desired.length &&
      desired.every((value: ObsJsonValue, index: number) => {
        const current = values[index];
        return current !== undefined && containsValue(current, value);
      })
    );
  }
  return observed === desired;
}

function isRecord(value: ObsJsonValue | undefined): value is ObsJsonObject {
  return value !== undefined && value !== null && Object(value) === value && !Array.isArray(value);
}

function itemIdentity(sceneUuid: string, sceneItemId: number): string {
  return `${sceneUuid}:${String(sceneItemId)}`;
}
