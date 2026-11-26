import { DEFAULT_MIX, type Mix } from "../core/audio.js";
import { intersectRects, type ContentAlignment, type Size } from "../core/geometry.js";
import {
  desiredObsAudio,
  OBS_DEFAULT_AUDIO,
  obsFilter,
  type DesiredObsAudio,
  type ObsAudioState,
} from "./audio.js";
import type { Item, Snapshot, SnapshotScene, Source } from "../core/snapshot.js";
import {
  managedFilterName,
  managedSceneName,
  managedSourceName,
  parseManagedName,
  registrySceneName,
} from "./naming.js";
import {
  indexManagedObservedState,
  type ManagedObservedIndex,
  type ObservedObsFilter,
  type ObservedObsInput,
  type ObservedObsScene,
  type ObservedObsSceneItem,
  type ObservedObsState,
} from "./observed-state.js";
import {
  validateOperationDependencies,
  type ObsAudioChange,
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
  readonly mix: Mix;
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
    mix: input.desired.mix ?? DEFAULT_MIX,
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
 * Creates the source's input, or converges its settings, audio and managed filters. A source
 * without a live handle keeps whatever input it has. An input of the wrong kind is a problem:
 * replacing it would lose the filters an operator added.
 */
function planInput(planning: Planning, source: Source): void {
  const handle = planning.input.handles.get(source.id);
  if (handle === undefined) return;
  const { kind, settings } = handle.input;
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
  if (handle.input.audio !== true) return;
  planAudio(planning, source, observed);
  planFilters(planning, source, observed);
}

/**
 * Converges each part of the input's audio that differs from the source's channel. A new input
 * starts with OBS's defaults; an existing one whose audio OBS did not report has none.
 */
function planAudio(
  planning: Planning,
  source: Source,
  observed: ObservedObsInput | undefined,
): void {
  const current = observed === undefined ? OBS_DEFAULT_AUDIO : observed.audio;
  if (current === undefined) return;
  const create = planning.inputCreates.get(source.id);
  for (const change of audioChanges(desiredObsAudio(source.audio, planning.mix), current)) {
    planning.operations.push({
      kind: "set-input-audio",
      key: `input:audio:${change.field}:${source.id}`,
      phase: "audio",
      dependsOn: create === undefined ? [] : [create],
      destructive: false,
      sourceId: source.id,
      change,
    });
  }
}

/** OBS keeps volume as a multiplier, so dB within this of the desired value is converged. */
const VOLUME_TOLERANCE_DB = 0.05;
/** Balance within this of the desired value is converged. */
const BALANCE_TOLERANCE = 0.001;

/** The parts of `desired` that `current` does not already have. */
function audioChanges(desired: DesiredObsAudio, current: ObsAudioState): ObsAudioChange[] {
  return [...levelChanges(desired, current), ...routingChanges(desired, current)];
}

/** Changes to how loud the input is and where it sits: mute, volume and balance. */
function levelChanges(desired: DesiredObsAudio, current: ObsAudioState): ObsAudioChange[] {
  const changes: ObsAudioChange[] = [];
  const { muted, volumeDb, balance } = desired;
  if (muted !== undefined && muted !== current.muted)
    changes.push({ field: "muted", value: muted });
  if (volumeDb !== undefined && !near(volumeDb, current.volumeDb, VOLUME_TOLERANCE_DB)) {
    changes.push({ field: "volumeDb", value: volumeDb });
  }
  if (balance !== undefined && !near(balance, current.balance, BALANCE_TOLERANCE)) {
    changes.push({ field: "balance", value: balance });
  }
  return changes;
}

/** Changes to when and where the input is heard: sync offset, monitoring and tracks. */
function routingChanges(desired: DesiredObsAudio, current: ObsAudioState): ObsAudioChange[] {
  const changes: ObsAudioChange[] = [];
  const { syncOffsetMs, monitorType, tracks } = desired;
  if (syncOffsetMs !== undefined && syncOffsetMs !== current.syncOffsetMs) {
    changes.push({ field: "syncOffsetMs", value: syncOffsetMs });
  }
  if (monitorType !== undefined && monitorType !== current.monitorType) {
    changes.push({ field: "monitorType", value: monitorType });
  }
  if (tracks !== undefined && !objectContains(current.tracks, tracks)) {
    changes.push({ field: "tracks", value: tracks });
  }
  return changes;
}

/** Whether two values are within `tolerance`; minus infinity is the quietest volume there is. */
function near(desired: number, current: number, tolerance: number): boolean {
  return Math.abs(Math.max(desired, -100) - Math.max(current, -100)) <= tolerance;
}

/** A managed filter the channel wants, by its OBS name. */
interface DesiredFilter {
  readonly filterName: string;
  readonly filterKind: string;
  readonly filterSettings: ObsJsonObject;
}

/**
 * Converges the input's managed filters to the channel's, in order: removes those the channel no
 * longer has (or whose kind changed), adds the missing ones after every other filter, converges
 * settings, then restacks the managed filters first when their order is wrong. Filters an
 * operator added are never touched. A new input has no filters; an existing one whose filters
 * OBS did not list is left alone.
 */
function planFilters(
  planning: Planning,
  source: Source,
  observed: ObservedObsInput | undefined,
): void {
  const current = observed === undefined ? [] : observed.filters;
  if (current === undefined) return;
  const desired: DesiredFilter[] = (source.audio?.filters ?? []).map((filter) => ({
    filterName: managedFilterName(planning.show, filter.id),
    ...obsFilter(filter),
  }));
  const kept = keptFilters(planning, source.id, current, desired);
  for (const filter of desired) {
    const existing = kept.get(filter.filterName);
    if (existing === undefined) {
      pushFilter(planning, source.id, "create", filter.filterName, filter);
    } else if (!objectContains(existing.filterSettings, filter.filterSettings)) {
      pushFilter(planning, source.id, "settings", filter.filterName, filter);
    }
  }
  if (filtersOrdered(desired, kept)) return;
  for (const [index, filter] of desired.entries()) {
    pushFilter(planning, source.id, "index", filter.filterName, { filterIndex: index });
  }
}

/**
 * The input's managed filters that stay, by name; removes the others: those the channel no
 * longer has, and those whose kind changed, which are created again.
 */
function keptFilters(
  planning: Planning,
  sourceId: string,
  current: readonly ObservedObsFilter[],
  desired: readonly DesiredFilter[],
): Map<string, ObservedObsFilter> {
  const wanted = new Map(desired.map((filter) => [filter.filterName, filter]));
  const kept = new Map<string, ObservedObsFilter>();
  for (const filter of current) {
    // Skip an operator's filter; keep a managed one of the wanted kind; remove the rest.
    if (parseManagedName(filter.filterName, planning.show)?.id === undefined) continue;
    const want = wanted.get(filter.filterName);
    if (want?.filterKind === filter.filterKind) kept.set(filter.filterName, filter);
    else pushFilter(planning, sourceId, "remove", filter.filterName, {});
  }
  return kept;
}

/** What one filter operation carries besides its input and name. */
interface FilterChange {
  readonly filterKind?: string;
  readonly filterSettings?: ObsJsonObject;
  readonly filterIndex?: number;
}

/** Adds one filter operation; creating one waits for its input when this plan creates it. */
function pushFilter(
  planning: Planning,
  sourceId: string,
  step: "remove" | "create" | "settings" | "index",
  filterName: string,
  change: FilterChange,
): void {
  const create = planning.inputCreates.get(sourceId);
  const base = {
    key: `filter:${step}:${sourceId}:${filterName}`,
    phase: "filters",
    dependsOn: create === undefined ? [] : [create],
    destructive: step === "remove",
    sourceId,
    filterName,
  } as const;
  switch (step) {
    case "remove":
      planning.operations.push({ ...base, kind: "remove-filter" });
      return;
    case "create":
      planning.operations.push({
        ...base,
        kind: "create-filter",
        filterKind: change.filterKind ?? "",
        filterSettings: change.filterSettings ?? {},
      });
      return;
    case "settings":
      planning.operations.push({
        ...base,
        kind: "set-filter-settings",
        filterSettings: change.filterSettings ?? {},
      });
      return;
    default:
      planning.operations.push({
        ...base,
        kind: "set-filter-index",
        filterIndex: change.filterIndex ?? 0,
      });
  }
}

/**
 * Whether the managed filters are in the channel's order once missing ones are added after
 * every other filter: the kept ones in increasing observed position, none after a new one.
 */
function filtersOrdered(
  desired: readonly DesiredFilter[],
  kept: ReadonlyMap<string, ObservedObsFilter>,
): boolean {
  let previous = Number.NEGATIVE_INFINITY;
  let created = false;
  for (const filter of desired) {
    const existing = kept.get(filter.filterName);
    if (existing === undefined) {
      created = true;
      continue;
    }
    if (created || existing.filterIndex <= previous) return false;
    previous = existing.filterIndex;
  }
  return true;
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
    planItemProperties(planning, scene, entry, source.size, observedItem);
  }
  planOrder(planning, scene, present);
  for (const sourceId of scene.audio ?? []) planAudioItem(planning, scene, sourceId);
}

/**
 * Where a source with no picture sits: one pixel outside the canvas, so an input that would show
 * something (a media source playing a stream's video) shows nothing, while its item stays active
 * and OBS mixes its audio.
 */
const PICTURELESS_TRANSFORM: ObsSceneItemTransform = {
  positionX: -2,
  positionY: -2,
  rotation: 0,
  alignment: 5,
  boundsType: "OBS_BOUNDS_STRETCH",
  boundsAlignment: 5,
  boundsWidth: 1,
  boundsHeight: 1,
  cropTop: 0,
  cropRight: 0,
  cropBottom: 0,
  cropLeft: 0,
};

/**
 * Places a source with no picture in the scene as an enabled item outside the canvas, which OBS
 * mixes while the scene is on program. It is not stacked among the scene's items.
 */
function planAudioItem(planning: Planning, scene: SnapshotScene, sourceId: string): void {
  const observedScene = planning.managed.scenes.get(scene.id);
  const observedInput = planning.managed.inputs.get(sourceId);
  const observedItem = findObservedItem(planning.managed, observedScene, observedInput);
  // Layer IDs are stable IDs, which never contain ':', so this cannot collide with one.
  const layerId = `audio:${sourceId}`;
  const entry = audioItemEntry(planning, scene, observedScene, observedItem, layerId, sourceId);
  if (entry === undefined) return;
  const { placement, dependsOn } = entry;
  if (!objectContains(observedItem?.sceneItemTransform ?? {}, PICTURELESS_TRANSFORM)) {
    planning.operations.push({
      kind: "set-transform",
      key: `placement:transform:${scene.id}:${layerId}`,
      phase: "transforms",
      dependsOn,
      destructive: false,
      placement,
      transform: PICTURELESS_TRANSFORM,
    });
  }
  if (observedItem?.sceneItemEnabled === true) return;
  planning.operations.push({
    kind: "set-enabled",
    key: `placement:enabled:${scene.id}:${layerId}`,
    phase: "enable",
    dependsOn,
    destructive: false,
    placement,
    enabled: true,
  });
}

/**
 * The pictureless source's observed item, marked as still placed, or a new one; undefined while
 * the source has no handle, which leaves its item as it is.
 */
function audioItemEntry(
  planning: Planning,
  scene: SnapshotScene,
  observedScene: ObservedObsScene | undefined,
  observedItem: ObservedObsSceneItem | undefined,
  layerId: string,
  sourceId: string,
): PresentItem | undefined {
  const item = picturelessItem(sourceId, layerId);
  if (observedScene !== undefined && observedItem !== undefined) {
    planning.matched.add(itemIdentity(observedScene.sceneUuid, observedItem.sceneItemId));
    if (!planning.input.handles.has(sourceId)) return undefined;
    return existingItem(item, observedScene, observedItem);
  }
  if (!planning.input.handles.has(sourceId) || !planning.sources.has(sourceId)) return undefined;
  return createItem(planning, scene, item);
}

/** The item a pictureless source's placement is planned as; only its IDs are read. */
function picturelessItem(sourceId: string, layerId: string): Item {
  const none = { x: 0, y: 0, width: 0, height: 0 };
  return {
    id: layerId,
    sourceId,
    frame: none,
    placement: {
      destination: none,
      sourceCrop: { top: 0, right: 0, bottom: 0, left: 0 },
      alignment: { horizontal: "center", vertical: "center" },
    },
    visible: true,
    opacity: 1,
    rotation: 0,
  };
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

/** Converges the item's transform and visibility; OBS items have no opacity, so it is ignored. */
function planItemProperties(
  planning: Planning,
  scene: SnapshotScene,
  entry: PresentItem,
  sourceSize: Size,
  observed: ObservedObsSceneItem | undefined,
): void {
  const { item, placement, dependsOn } = entry;
  const transform = toObsTransform(item, sourceSize, planning.input.observed.cropToBounds === true);
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
  for (const scene of keptScenes) {
    const stale = (item: ObservedObsSceneItem): boolean =>
      scene === managed.registry
        ? removedInputs.has(item.sourceUuid)
        : !planning.matched.has(itemIdentity(scene.sceneUuid, item.sceneItemId)) &&
          parseManagedName(item.sourceName, show) !== undefined;
    for (const item of (managed.itemsByScene.get(scene.sceneUuid) ?? []).filter(stale)) {
      const key = `placement:remove:${scene.sceneUuid}:${String(item.sceneItemId)}`;
      removals.push(key);
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
 * The item's OBS transform. A whole-source `cover` or `contain` that OBS can fit by itself uses
 * its bounds (`nativeFitTransform`), which need no source size; everything else uses stretch
 * bounds and source-pixel crop (`pixelTransform`). Where OBS takes `cropToBounds`, every
 * transform but `cover` sets it off, which items OBS never cropped already report.
 */
function toObsTransform(
  item: Item,
  sourceSize: Size,
  cropToBounds: boolean,
): ObsSceneItemTransform {
  const native = nativeFitTransform(item, cropToBounds);
  if (native !== undefined) return native;
  const transform = pixelTransform(item, sourceSize);
  return cropToBounds ? { ...transform, cropToBounds: false } : transform;
}

/** OBS bounds types that fit a source by its real size, by fit. */
const NATIVE_BOUNDS = { cover: "OBS_BOUNDS_SCALE_OUTER", contain: "OBS_BOUNDS_SCALE_INNER" };

/**
 * Lets OBS fit the whole source into the frame at whatever size its picture really is: `cover`
 * as scale-outer bounds cropped to the bounds, `contain` as scale-inner bounds, aligned by the
 * layer's `align`. For a source of its declared size the picture is the pixel path's, to within
 * a pixel of rounding, and it stays right when the real size differs or changes. Undefined, for the pixel path, when:
 *
 * - the placement is not a whole-source fit (a `crop`, or a snapshot from before 3.1), or is
 *   `stretch`, which the pixel path already draws without the source size;
 * - the canvas clips the frame: the cut would have to be added to the crop in source pixels;
 * - `cover`, and OBS takes no `cropToBounds` (obs-websocket before 5.5.0), so it would overflow;
 * - `contain` with a rotation: OBS rotates the bounds about their corner, while the pixel path
 *   rotates the fitted picture about its own, so the picture would land elsewhere.
 */
function nativeFitTransform(item: Item, cropToBounds: boolean): ObsSceneItemTransform | undefined {
  const { fit, alignment } = item.placement;
  if ((fit !== "cover" && fit !== "contain") || item.clip !== undefined) return undefined;
  if (fit === "cover" ? !cropToBounds : item.rotation !== 0) return undefined;
  const transform: ObsSceneItemTransform = {
    positionX: item.frame.x,
    positionY: item.frame.y,
    rotation: item.rotation,
    alignment: 5,
    boundsType: NATIVE_BOUNDS[fit],
    boundsAlignment: obsAlignment(alignment),
    boundsWidth: item.frame.width,
    boundsHeight: item.frame.height,
    cropTop: 0,
    cropRight: 0,
    cropBottom: 0,
    cropLeft: 0,
  };
  return cropToBounds ? { ...transform, cropToBounds: fit === "cover" } : transform;
}

/** OBS alignment flags: center is 0, then left 1, right 2, top 4, bottom 8. */
function obsAlignment(alignment: ContentAlignment): number {
  const horizontal = { left: 1, center: 0, right: 2 }[alignment.horizontal];
  const vertical = { top: 4, center: 0, bottom: 8 }[alignment.vertical];
  return horizontal | vertical;
}

/**
 * Whether the snapshot places a whole-source `cover` that only `cropToBounds` lets OBS fit by
 * itself, so an OBS without it draws that item from the declared source size.
 */
export function needsCropToBounds(snapshot: Snapshot): boolean {
  return snapshot.scenes.some((scene) =>
    scene.items.some((item) => item.placement.fit === "cover" && item.clip === undefined),
  );
}

/**
 * Converts compiled placement and clipping into OBS stretch bounds and source-pixel crop. A clip
 * (the canvas cutting the frame) shrinks the bounds and adds the cut part to the crop. The crop
 * is in pixels of the declared source size, so a picture of another size is drawn wrongly.
 */
function pixelTransform(item: Item, sourceSize: Size): ObsSceneItemTransform {
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
