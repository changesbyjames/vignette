import { omitUndefined } from "@strangecyan/vignette-core";
import {
  intersectRects,
  type CompiledItem,
  type CompiledScene,
  type CompiledSnapshot,
  type CompiledSource,
  type BrowserSource,
  type Insets,
  type SceneId,
  type Size,
  type AnySourceDefinition,
  type SourceId,
} from "@strangecyan/vignette-core";
import { equals } from "ramda";

import { validateObsCapabilities } from "./capabilities.js";
import type { ObsCodecMap } from "./codecs/index.js";
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
  type CreatePlacementOperation,
  type ObsContentRef,
  type ObsJsonObject,
  type ObsJsonValue,
  type ObsOperation,
  type ObsPlan,
  type ObsSceneItemTransform,
  type ObsSceneRef,
  type ObsPlacementRef,
} from "./operations.js";
import { obsDiagnostic, type ObsDiagnostic, type ObsPlanningResult } from "./plan.js";

interface CropScale {
  readonly x: number;
  readonly y: number;
}

/** Desired snapshot, observed OBS state, assets, and codecs supplied to the planner. */
export interface ObsPlannerInput {
  readonly desired: CompiledSnapshot;
  readonly observed: ObservedObsState;
  readonly resolvedAssets: ReadonlyMap<SourceId, string>;
  readonly codecs: ObsCodecMap;
  /** Absolute base OBS uses for root-relative URLs it loads itself, such as browser sources. */
  readonly browserSourceBaseUrl?: string;
}

interface PlannedSource {
  readonly definition: AnySourceDefinition;
  readonly intrinsicSize?: Size;
  readonly inputKind: string;
  readonly settings: ObsJsonObject;
  readonly browserGeometry?: BrowserGeometry;
  readonly observed?: ObservedObsInput;
  readonly createKey?: string;
}

interface BrowserGeometry {
  readonly viewport: Size;
  readonly cropScale: Readonly<CropScale>;
}

/** Purely transforms desired and observed state into a dependency-aware OBS plan. */
export function planObsUpdate(input: ObsPlannerInput): ObsPlanningResult {
  const diagnostics: ObsDiagnostic[] = [...validateObsCapabilities(input.observed.capabilities)];
  const operations: ObsOperation[] = [];
  const managed = indexManagedObservedState(input.observed, input.desired.projectId);

  for (const duplicate of managed.duplicatePlacements) {
    diagnostics.push(
      obsDiagnostic(
        "OBS_AMBIGUOUS_PLACEMENT",
        "error",
        `obs.scene.${duplicate.sceneUuid}`,
        `OBS contains repeated placements of source '${duplicate.sourceUuid}' in one managed scene.`,
        duplicate.sceneItemIds.map(String),
      ),
    );
  }

  const registryCreateKey = managed.registry === undefined ? "scene:create:registry" : undefined;
  if (registryCreateKey !== undefined) {
    operations.push({
      kind: "create-scene",
      key: registryCreateKey,
      phase: "scenes",
      dependsOn: [],
      destructive: false,
      scene: { kind: "registry" },
      sceneName: registrySceneName(input.desired.projectId),
    });
  }

  const sceneCreateKeys = new Map<SceneId, string>();
  for (const scene of input.desired.scenes) {
    if (managed.scenes.has(scene.id)) continue;
    const key = `scene:create:${scene.id}`;
    sceneCreateKeys.set(scene.id, key);
    operations.push({
      kind: "create-scene",
      key,
      phase: "scenes",
      dependsOn: [],
      destructive: false,
      scene: { kind: "scene", sceneId: scene.id },
      sceneName: managedSceneName(input.desired.projectId, scene.id),
    });
  }

  const referencedSourceIds = collectReferencedSources(input.desired.scenes);
  const plannedSources = prepareSources(input, managed, registryCreateKey, operations, diagnostics);

  const matchedSceneItemIds = new Set<string>();
  for (const scene of input.desired.scenes) {
    planSceneItems(
      scene,
      input,
      managed,
      plannedSources,
      sceneCreateKeys,
      operations,
      diagnostics,
      matchedSceneItemIds,
    );
  }

  pruneManagedResources(
    input,
    managed,
    referencedSourceIds,
    new Set(input.desired.scenes.map((scene) => scene.id)),
    matchedSceneItemIds,
    [],
    operations,
  );

  const dependencyErrors = validateOperationDependencies(operations);
  diagnostics.push(
    ...dependencyErrors.map((message) =>
      obsDiagnostic("OBS_INVALID_PLAN", "error", "obs.plan", message),
    ),
  );
  diagnostics.sort((left, right) =>
    left.path === right.path
      ? left.code.localeCompare(right.code)
      : left.path.localeCompare(right.path),
  );

  if (diagnostics.some((item) => item.severity === "error")) {
    return { ok: false, diagnostics };
  }

  const plan: ObsPlan = {
    revision: input.desired.revision,
    observationEpoch: input.observed.observationEpoch,
    operations,
  };
  return { ok: true, plan, diagnostics };
}

function planSceneItems(
  scene: CompiledScene,
  input: ObsPlannerInput,
  managed: ManagedObservedIndex,
  plannedSources: ReadonlyMap<SourceId, PlannedSource>,
  sceneCreateKeys: ReadonlyMap<SceneId, string>,
  operations: ObsOperation[],
  diagnostics: ObsDiagnostic[],
  matchedSceneItemIds: Set<string>,
): void {
  scene.items.forEach((item, index) => {
    planSceneItem(
      item,
      index,
      scene,
      input,
      managed,
      plannedSources,
      sceneCreateKeys,
      operations,
      diagnostics,
      matchedSceneItemIds,
    );
  });
}
/** Match a layer to one observed placement, or create it after its scene and content exist. */
function planSceneItem(
  item: CompiledItem,
  index: number,
  scene: CompiledScene,
  input: ObsPlannerInput,
  managed: ManagedObservedIndex,
  plannedSources: ReadonlyMap<SourceId, PlannedSource>,
  sceneCreateKeys: ReadonlyMap<SceneId, string>,
  operations: ObsOperation[],
  diagnostics: ObsDiagnostic[],
  matchedSceneItemIds: Set<string>,
): void {
  const sceneRef: ObsSceneRef = { kind: "scene", sceneId: scene.id };
  const observedScene = managed.scenes.get(scene.id);
  const materialization = resolveMaterialization(
    item,
    input.desired.canvas,
    managed,
    plannedSources,
    sceneCreateKeys,
  );
  if (materialization === undefined) return;
  if (!supportsClip(scene, item, materialization, diagnostics)) return;

  const observedItem = findObservedItem(observedScene, materialization.observedSourceUuid, managed);
  if (observedScene !== undefined && observedItem !== undefined) {
    matchedSceneItemIds.add(sceneItemIdentity(observedScene.sceneUuid, observedItem.sceneItemId));
  }

  const dependencies = collectPlacementDependencies(
    sceneCreateKeys.get(scene.id),
    materialization.createDependency,
  );

  let createPlacementKey: string | undefined = undefined;
  if (observedItem === undefined) {
    createPlacementKey = `placement:create:${scene.id}:${item.id}`;
    const operation: CreatePlacementOperation = {
      kind: "create-placement",
      key: createPlacementKey,
      phase: "placements",
      dependsOn: dependencies,
      destructive: false,
      layerId: item.id,
      scene: sceneRef,
      content: materialization.content,
    };
    operations.push(operation);
  }

  const placementDependencies = createPlacementKey === undefined ? [] : [createPlacementKey];
  const placement: ObsPlacementRef =
    observedScene !== undefined && observedItem !== undefined
      ? {
          kind: "existing",
          sceneUuid: observedScene.sceneUuid,
          sceneItemId: observedItem.sceneItemId,
        }
      : { kind: "created", layerId: item.id, scene: sceneRef };
  planPlacementProperties(
    scene,
    item,
    index,
    materialization,
    observedItem,
    placement,
    placementDependencies,
    operations,
    diagnostics,
  );
}
/** Update only changed transform, ordering, and visibility properties of a placement. */
function planPlacementProperties(
  scene: CompiledScene,
  item: CompiledItem,
  index: number,
  materialization: Materialization,
  observedItem: ObservedObsSceneItem | undefined,
  placement: ObsPlacementRef,
  placementDependencies: readonly string[],
  operations: ObsOperation[],
  diagnostics: ObsDiagnostic[],
): void {
  const transform = toObsTransform(
    item,
    materialization.sourceSize,
    materialization.sourceCropScale,
  );
  if (
    observedItem === undefined ||
    !objectContains(observedItem.sceneItemTransform ?? {}, transform)
  ) {
    operations.push({
      kind: "set-transform",
      key: `placement:transform:${scene.id}:${item.id}`,
      phase: "transforms",
      dependsOn: placementDependencies,
      destructive: false,
      placement,
      transform,
    });
  }

  if (observedItem?.sceneItemIndex !== index) {
    operations.push({
      kind: "set-order",
      key: `placement:order:${scene.id}:${item.id}`,
      phase: "ordering",
      dependsOn: placementDependencies,
      destructive: false,
      placement,
      sceneItemIndex: index,
    });
  }

  if (observedItem === undefined ? item.visible : observedItem.sceneItemEnabled !== item.visible) {
    operations.push({
      kind: "set-enabled",
      key: `placement:enabled:${scene.id}:${item.id}`,
      phase: "enable",
      dependsOn: placementDependencies,
      destructive: false,
      placement,
      enabled: item.visible,
    });
  }

  if (item.opacity !== 1) {
    diagnostics.push(
      obsDiagnostic(
        "OBS_UNSUPPORTED_FEATURE",
        "warning",
        `scene.${scene.id}.item.${item.id}.opacity`,
        "OBS scene items do not expose native opacity through obs-websocket; opacity is omitted.",
        [item.id],
      ),
    );
  }
}

interface Materialization {
  readonly content: ObsContentRef;
  readonly sourceSize?: Size;
  readonly sourceCropScale?: Readonly<CropScale>;
  readonly observedSourceUuid?: string;
  readonly createDependency?: string;
}

/** Inputs inherit their compiled dimensions and creation dependency; nested scenes use the canvas dimensions. */
function resolveMaterialization(
  item: CompiledItem,
  canvas: Size,
  managed: ManagedObservedIndex,
  plannedSources: ReadonlyMap<SourceId, PlannedSource>,
  sceneCreateKeys: ReadonlyMap<SceneId, string>,
): Materialization | undefined {
  if (item.content.kind === "source") {
    // Inputs inherit their compiled dimensions and creation dependency; nested scenes use the canvas dimensions.

    const source = plannedSources.get(item.content.sourceId);
    if (source === undefined) return undefined;
    const sourceSize = source.browserGeometry?.viewport ?? source.intrinsicSize;
    return {
      content: { kind: "input", sourceId: item.content.sourceId },
      ...omitUndefined({ sourceSize: sourceSize }),
      ...omitUndefined({
        sourceCropScale: source.browserGeometry?.cropScale,
      }),
      ...omitUndefined({
        observedSourceUuid: source.observed?.inputUuid,
      }),
      ...omitUndefined({ createDependency: source.createKey }),
    };
  }

  const observedScene = managed.scenes.get(item.content.sceneId);
  const createDependency = sceneCreateKeys.get(item.content.sceneId);
  return {
    content: { kind: "scene", sceneId: item.content.sceneId },
    sourceSize: canvas,
    ...omitUndefined({
      observedSourceUuid: observedScene?.sceneUuid,
    }),
    ...omitUndefined({ createDependency: createDependency }),
  };
}

/** Reuse a placement only when its observed scene and source UUID identify exactly one matching item. */
function findObservedItem(
  scene: ObservedObsScene | undefined,
  sourceUuid: string | undefined,
  managed: ManagedObservedIndex,
): ObservedObsSceneItem | undefined {
  if (scene === undefined || sourceUuid === undefined) return undefined;
  const matches = (managed.itemsByScene.get(scene.sceneUuid) ?? []).filter(
    (item) => item.sourceUuid === sourceUuid,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function collectReferencedSources(scenes: readonly CompiledScene[]): ReadonlySet<SourceId> {
  const result = new Set<SourceId>();
  for (const scene of scenes) {
    for (const item of scene.items) {
      if (item.content.kind === "source") result.add(item.content.sourceId);
    }
  }
  return result;
}

/** Shared browser inputs must realize one viewport size; conflicting placements produce a diagnostic and remove that source's geometry. */
function collectBrowserGeometries(
  scenes: readonly CompiledScene[],
  sources: ReadonlyMap<SourceId, CompiledSource>,
  diagnostics: ObsDiagnostic[],
): ReadonlyMap<SourceId, BrowserGeometry> {
  const result = new Map<SourceId, BrowserGeometry>();
  const conflicts = new Set<SourceId>();

  for (const item of scenes.flatMap((scene) => scene.items)) {
    if (item.content.kind !== "source") continue;
    const source = sources.get(item.content.sourceId)?.definition;
    if (source?.kind !== "source:browser") continue;
    const geometry = realizeBrowserGeometry(
      /* SAFETY: The source kind was checked as browser, whose registered module validates the viewport before compilation. */ (
        source as BrowserSource
      ).viewport,
      item,
    );
    if (geometry === undefined || conflicts.has(source.id)) continue;
    const existing = result.get(source.id);
    if (existing === undefined) {
      result.set(source.id, geometry);
      continue;
    }
    if (sameSize(existing.viewport, geometry.viewport)) continue;
    diagnostics.push(
      obsDiagnostic(
        "OBS_UNSUPPORTED_FEATURE",
        "error",
        `source.${source.id}.viewport`,
        `OBS browser source '${source.id}' resolves to both ${formatSize(existing.viewport)} and ${formatSize(geometry.viewport)}. Use distinct source IDs for placements with different realized sizes.`,
        [source.id],
      ),
    );
    conflicts.add(source.id);
    result.delete(source.id);
  }

  return result;
}

/** Expand the browser viewport to account for cropping, then round realized dimensions while preserving crop scale. */
function realizeBrowserGeometry(
  declaredViewport: Size,
  item: CompiledItem,
): BrowserGeometry | undefined {
  const placement = item.placement;
  const destination = placement?.destination ?? item.frame;
  const crop = placement?.sourceCrop ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const effectiveWidth = declaredViewport.width - crop.left - crop.right;
  const effectiveHeight = declaredViewport.height - crop.top - crop.bottom;
  if (effectiveWidth <= 0 || effectiveHeight <= 0) return undefined;

  const width = Math.max(
    1,
    Math.round((declaredViewport.width * destination.width) / effectiveWidth),
  );
  const height = Math.max(
    1,
    Math.round((declaredViewport.height * destination.height) / effectiveHeight),
  );
  return {
    viewport: { width, height },
    cropScale: { x: width / declaredViewport.width, y: height / declaredViewport.height },
  };
}

/** Convert compiled placement and clipping into OBS stretch bounds and source-pixel crop values. */
function toObsTransform(
  item: CompiledItem,
  sourceSize: Size | undefined,
  sourceCropScale: Readonly<CropScale> | undefined,
): ObsSceneItemTransform {
  const destination = item.placement?.destination ?? item.frame;
  const baseCrop = scaleCrop(
    item.placement?.sourceCrop ?? { top: 0, right: 0, bottom: 0, left: 0 },
    sourceCropScale,
  );
  const visibleDestination =
    item.clip === undefined ? destination : (intersectRects(destination, item.clip) ?? destination);
  let crop = baseCrop;
  if (item.clip !== undefined && sourceSize !== undefined) {
    const uncroppedWidth = sourceSize.width - baseCrop.left - baseCrop.right;
    const uncroppedHeight = sourceSize.height - baseCrop.top - baseCrop.bottom;
    const scaleX = destination.width / uncroppedWidth;
    const scaleY = destination.height / uncroppedHeight;
    crop = {
      left: roundTransform(baseCrop.left + (visibleDestination.x - destination.x) / scaleX),
      right: roundTransform(
        baseCrop.right +
          (destination.x + destination.width - visibleDestination.x - visibleDestination.width) /
            scaleX,
      ),
      top: roundTransform(baseCrop.top + (visibleDestination.y - destination.y) / scaleY),
      bottom: roundTransform(
        baseCrop.bottom +
          (destination.y + destination.height - visibleDestination.y - visibleDestination.height) /
            scaleY,
      ),
    };
  }
  return {
    positionX: visibleDestination.x,
    positionY: visibleDestination.y,
    rotation: item.rotation,
    alignment: 5,
    boundsType: "OBS_BOUNDS_STRETCH",
    boundsAlignment: 5,
    boundsWidth: visibleDestination.width,
    boundsHeight: visibleDestination.height,
    cropTop: crop.top,
    cropRight: crop.right,
    cropBottom: crop.bottom,
    cropLeft: crop.left,
  };
}

function scaleCrop(crop: Insets, scale: Readonly<CropScale> | undefined): Insets {
  if (scale === undefined) return crop;
  return {
    top: roundTransform(crop.top * scale.y),
    right: roundTransform(crop.right * scale.x),
    bottom: roundTransform(crop.bottom * scale.y),
    left: roundTransform(crop.left * scale.x),
  };
}

function sameSize(left: Size, right: Size): boolean {
  return left.width === right.width && left.height === right.height;
}

function formatSize(size: Size): string {
  return `${String(size.width)}x${String(size.height)}`;
}

function roundTransform(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Whether `observed` already satisfies `desired`, treating objects as recursive subsets. */
function objectContains(observed: ObsJsonObject, desired: ObsJsonObject): boolean {
  return Object.entries(desired).every(([key, value]) => containsValue(observed[key], value));
}

/** Objects match recursively as subsets; arrays require equal lengths and matching elements in order. */
function containsValue(
  observed: ObsJsonValue | undefined,
  desired: ObsJsonValue | undefined,
): boolean {
  if (isRecord(observed) && isRecord(desired)) return objectContains(observed, desired);
  if (Array.isArray(observed) && Array.isArray(desired)) {
    return (
      observed.length === desired.length &&
      desired.every((value: ObsJsonValue, index: number) =>
        containsValue(
          /* SAFETY: Both arrays come from the closed JSON value union; indexing preserves a JSON element or undefined. */ observed[
            index
          ] as ObsJsonValue,
          value,
        ),
      )
    );
  }
  return equals(observed, desired);
}

function isRecord(value: ObsJsonValue | undefined): value is ObsJsonObject {
  return value !== undefined && value !== null && Object(value) === value && !Array.isArray(value);
}

function sceneItemIdentity(sceneUuid: string, sceneItemId: number): string {
  return `${sceneUuid}:${String(sceneItemId)}`;
}

/** Compile only referenced inputs, retaining source ownership and creation dependencies. */
function prepareSources(
  input: ObsPlannerInput,
  managed: ManagedObservedIndex,
  registryCreateKey: string | undefined,
  operations: ObsOperation[],
  diagnostics: ObsDiagnostic[],
): ReadonlyMap<SourceId, PlannedSource> {
  const availableInputKinds = new Set(input.observed.capabilities.inputKinds);
  const referencedSourceIds = collectReferencedSources(input.desired.scenes);
  const compiledSources = new Map(input.desired.sources.map((source) => [source.id, source]));
  const browserGeometries = collectBrowserGeometries(
    input.desired.scenes,
    compiledSources,
    diagnostics,
  );
  const plannedSources = new Map<SourceId, PlannedSource>();

  for (const sourceId of referencedSourceIds) {
    prepareSource(
      sourceId,
      input,
      managed,
      registryCreateKey,
      availableInputKinds,
      compiledSources,
      browserGeometries,
      plannedSources,
      operations,
      diagnostics,
    );
  }
  return plannedSources;
}

/** Reject unsupported codecs and kind changes before scheduling an input mutation. */
function prepareSource(
  sourceId: SourceId,
  input: ObsPlannerInput,
  managed: ManagedObservedIndex,
  registryCreateKey: string | undefined,
  availableInputKinds: ReadonlySet<string>,
  compiledSources: ReadonlyMap<SourceId, CompiledSource>,
  browserGeometries: ReadonlyMap<SourceId, BrowserGeometry>,
  plannedSources: Map<SourceId, PlannedSource>,
  operations: ObsOperation[],
  diagnostics: ObsDiagnostic[],
): void {
  const source = compiledSources.get(sourceId);
  if (source === undefined) return;
  const definition = source.definition;
  const codec = input.codecs.get(definition.kind);
  if (codec === undefined) {
    diagnostics.push(
      obsDiagnostic(
        "OBS_UNSUPPORTED_SOURCE",
        "error",
        `source.${sourceId}`,
        `No OBS codec is registered for source kind '${definition.kind}'. Pass its extension to the OBS runtime.`,
        [sourceId],
      ),
    );
    return;
  }
  const resolvedAsset = input.resolvedAssets.get(sourceId);
  const browserGeometry = browserGeometries.get(sourceId);
  const compiled = codec.compile(definition, {
    availableInputKinds,
    ...omitUndefined({ resolvedAsset: resolvedAsset }),
    ...omitUndefined({ baseUrl: input.browserSourceBaseUrl }),
    ...omitUndefined({
      browserViewport: browserGeometry === undefined ? undefined : browserGeometry.viewport,
    }),
  });
  if (!compiled.supported) {
    diagnostics.push(
      obsDiagnostic("OBS_UNSUPPORTED_SOURCE", "error", `source.${sourceId}`, compiled.reason, [
        sourceId,
      ]),
    );
    return;
  }

  const observed = managed.inputs.get(sourceId);
  if (observed !== undefined && observed.inputKind !== compiled.inputKind) {
    diagnostics.push(
      obsDiagnostic(
        "OBS_INPUT_KIND_MISMATCH",
        "error",
        `source.${sourceId}`,
        `Managed input uses '${observed.inputKind}', expected '${compiled.inputKind}'.`,
        [sourceId, observed.inputUuid],
      ),
    );
    return;
  }

  let createKey: string | undefined = undefined;
  if (observed === undefined) {
    createKey = `input:create:${sourceId}`;
    operations.push({
      kind: "create-input",
      key: createKey,
      phase: "inputs",
      dependsOn: registryCreateKey === undefined ? [] : [registryCreateKey],
      destructive: false,
      sourceId,
      inputName: managedSourceName(input.desired.projectId, sourceId),
      inputKind: compiled.inputKind,
      inputSettings: compiled.settings,
    });
  } else if (!objectContains(observed.inputSettings, compiled.settings)) {
    operations.push({
      kind: "set-input-settings",
      key: `input:settings:${sourceId}`,
      phase: "settings",
      dependsOn: [],
      destructive: false,
      sourceId,
      inputSettings: compiled.settings,
    });
  }

  plannedSources.set(sourceId, {
    definition,
    ...omitUndefined({ intrinsicSize: source.intrinsicSize }),
    inputKind: compiled.inputKind,
    settings: compiled.settings,
    ...omitUndefined({ browserGeometry: browserGeometry }),
    ...omitUndefined({ observed: observed }),
    ...omitUndefined({ createKey: createKey }),
  });
}

/** Ambiguous placements make deletion unsafe; input removals wait for every dependent removal. */
function pruneManagedResources(
  input: ObsPlannerInput,
  managed: ManagedObservedIndex,
  referencedSourceIds: ReadonlySet<SourceId>,
  desiredSceneIds: ReadonlySet<SceneId>,
  matchedSceneItemIds: ReadonlySet<string>,
  removalKeys: string[],
  operations: ObsOperation[],
): void {
  if (managed.duplicatePlacements.length !== 0) return;
  pruneRegistryPlacements(managed, referencedSourceIds, removalKeys, operations);
  pruneScenePlacements(
    input,
    managed,
    desiredSceneIds,
    matchedSceneItemIds,
    removalKeys,
    operations,
  );
  pruneScenes(managed, desiredSceneIds, removalKeys, operations);
  pruneInputs(managed, referencedSourceIds, removalKeys, operations);
}
/** Remove registry placements only for managed inputs no longer referenced by the snapshot. */
function pruneRegistryPlacements(
  managed: ManagedObservedIndex,
  referencedSourceIds: ReadonlySet<SourceId>,
  removalKeys: string[],
  operations: ObsOperation[],
): void {
  if (managed.registry !== undefined) {
    // Remove only registry items belonging to managed inputs that no desired scene references.

    for (const [sourceId, observedInput] of managed.inputs) {
      // Remove only registry items belonging to managed inputs that no desired scene references.

      if (referencedSourceIds.has(sourceId)) continue;
      for (const item of managed.itemsByScene.get(managed.registry.sceneUuid) ?? []) {
        if (item.sourceUuid !== observedInput.inputUuid) continue;
        const key = `placement:remove:${managed.registry.sceneUuid}:${String(item.sceneItemId)}`;
        removalKeys.push(key);
        operations.push({
          kind: "remove-placement",
          key,
          phase: "remove-placements",
          dependsOn: [],
          destructive: true,
          sceneUuid: managed.registry.sceneUuid,
          sceneItemId: item.sceneItemId,
        });
      }
    }
  }
}
/** Preserve foreign scene items and any placements already matched to desired layers. */
function pruneScenePlacements(
  input: ObsPlannerInput,
  managed: ManagedObservedIndex,
  desiredSceneIds: ReadonlySet<SceneId>,
  matchedSceneItemIds: ReadonlySet<string>,
  removalKeys: string[],
  operations: ObsOperation[],
): void {
  for (const [sceneId, observedScene] of managed.scenes) {
    // Keep matched layers and foreign namespace content when pruning placements from surviving scenes.

    if (!desiredSceneIds.has(sceneId)) continue;
    for (const item of managed.itemsByScene.get(observedScene.sceneUuid) ?? []) {
      if (matchedSceneItemIds.has(sceneItemIdentity(observedScene.sceneUuid, item.sceneItemId)))
        continue;
      const managedSource = parseManagedName(item.sourceName);
      if (managedSource?.projectId !== input.desired.projectId) continue;
      const key = `placement:remove:${observedScene.sceneUuid}:${String(item.sceneItemId)}`;
      removalKeys.push(key);
      operations.push({
        kind: "remove-placement",
        key,
        phase: "remove-placements",
        dependsOn: [],
        destructive: true,
        sceneUuid: observedScene.sceneUuid,
        sceneItemId: item.sceneItemId,
      });
    }
  }
}
/** Unreferenced managed scenes can be removed before their source inputs. */
function pruneScenes(
  managed: ManagedObservedIndex,
  desiredSceneIds: ReadonlySet<SceneId>,
  removalKeys: string[],
  operations: ObsOperation[],
): void {
  for (const [sceneId, observedScene] of managed.scenes) {
    if (desiredSceneIds.has(sceneId)) continue;
    const key = `scene:remove:${sceneId}`;
    removalKeys.push(key);
    operations.push({
      kind: "remove-scene",
      key,
      phase: "remove-scenes",
      dependsOn: [],
      destructive: true,
      sceneUuid: observedScene.sceneUuid,
    });
  }
}
/** Wait for placement and scene removals before releasing their shared inputs. */
function pruneInputs(
  managed: ManagedObservedIndex,
  referencedSourceIds: ReadonlySet<SourceId>,
  removalKeys: string[],
  operations: ObsOperation[],
): void {
  for (const [sourceId, observedInput] of managed.inputs) {
    if (referencedSourceIds.has(sourceId)) continue;
    operations.push({
      kind: "remove-input",
      key: `input:remove:${sourceId}`,
      phase: "remove-inputs",
      dependsOn: removalKeys,
      destructive: true,
      inputUuid: observedInput.inputUuid,
    });
  }
}

/** Clipping requires source dimensions so crop pixels can be computed unambiguously. */
function supportsClip(
  scene: CompiledScene,
  item: CompiledItem,
  materialization: Materialization,
  diagnostics: ObsDiagnostic[],
): boolean {
  if (item.clip !== undefined && materialization.sourceSize === undefined) {
    diagnostics.push(
      obsDiagnostic(
        "OBS_UNSUPPORTED_FEATURE",
        "error",
        `scene.${scene.id}.item.${item.id}.clip`,
        `Clipped OBS item '${item.id}' requires an explicit source size.`,
        [item.id],
      ),
    );
    return false;
  }

  return true;
}

function collectPlacementDependencies(
  scene: string | undefined,
  source: string | undefined,
): string[] {
  return [scene, source].filter((dependency): dependency is string => dependency !== undefined);
}
