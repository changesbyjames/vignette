import {
  intersectRects,
  type CompiledItem,
  type CompiledScene,
  type CompiledSnapshot,
  type CompiledSource,
  type Insets,
  type SceneId,
  type Size,
  type SourceDefinition,
  type SourceId,
} from "@cbj/vignette-core";
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
  type ObsOperation,
  type ObsPlan,
  type ObsSceneItemTransform,
  type ObsSceneRef,
} from "./operations.js";
import { obsDiagnostic, type ObsDiagnostic, type ObsPlanningResult } from "./plan.js";

export interface ObsPlannerInput {
  readonly desired: CompiledSnapshot;
  readonly observed: ObservedObsState;
  readonly resolvedAssets: ReadonlyMap<SourceId, string>;
  readonly codecs: ObsCodecMap;
}

interface PlannedSource {
  readonly definition: SourceDefinition;
  readonly intrinsicSize?: Size;
  readonly inputKind: string;
  readonly settings: ObsJsonObject;
  readonly browserGeometry?: BrowserGeometry;
  readonly observed?: ObservedObsInput;
  readonly createKey?: string;
}

interface BrowserGeometry {
  readonly viewport: Size;
  readonly cropScale: Readonly<{ x: number; y: number }>;
}

export function planObsUpdate(input: ObsPlannerInput): ObsPlanningResult {
  const diagnostics: ObsDiagnostic[] = [...validateObsCapabilities(input.observed.capabilities)];
  const operations: ObsOperation[] = [];
  const managed = indexManagedObservedState(input.observed, input.desired.projectId);
  const availableInputKinds = new Set(input.observed.capabilities.inputKinds);

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
  const compiledSources = new Map(input.desired.sources.map((source) => [source.id, source]));
  const browserGeometries = collectBrowserGeometries(
    input.desired.scenes,
    compiledSources,
    diagnostics,
  );
  const plannedSources = new Map<SourceId, PlannedSource>();

  for (const sourceId of referencedSourceIds) {
    const source = compiledSources.get(sourceId);
    if (source === undefined) continue;
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
      continue;
    }
    const resolvedAsset = input.resolvedAssets.get(sourceId);
    const browserGeometry = browserGeometries.get(sourceId);
    const compiled = codec.compile(definition, {
      availableInputKinds,
      ...(resolvedAsset === undefined ? {} : { resolvedAsset }),
      ...(browserGeometry === undefined ? {} : { browserViewport: browserGeometry.viewport }),
    });
    if (!compiled.supported) {
      diagnostics.push(
        obsDiagnostic("OBS_UNSUPPORTED_SOURCE", "error", `source.${sourceId}`, compiled.reason, [
          sourceId,
        ]),
      );
      continue;
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
      continue;
    }

    let createKey: string | undefined;
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
      ...(source.intrinsicSize === undefined ? {} : { intrinsicSize: source.intrinsicSize }),
      inputKind: compiled.inputKind,
      settings: compiled.settings,
      ...(browserGeometry === undefined ? {} : { browserGeometry }),
      ...(observed === undefined ? {} : { observed }),
      ...(createKey === undefined ? {} : { createKey }),
    });
  }

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

  const destructiveAllowed = managed.duplicatePlacements.length === 0;
  const desiredSceneIds = new Set(input.desired.scenes.map((scene) => scene.id));
  const removalKeys: string[] = [];

  if (destructiveAllowed) {
    if (managed.registry !== undefined) {
      for (const [sourceId, observedInput] of managed.inputs) {
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

    for (const [sceneId, observedScene] of managed.scenes) {
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
  const sceneRef: ObsSceneRef = { kind: "scene", sceneId: scene.id };
  const observedScene = managed.scenes.get(scene.id);

  scene.items.forEach((item, index) => {
    const materialization = resolveMaterialization(
      item,
      input.desired.canvas,
      managed,
      plannedSources,
      sceneCreateKeys,
    );
    if (materialization === undefined) return;
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
      return;
    }

    const observedItem = findObservedItem(
      observedScene,
      materialization.observedSourceUuid,
      managed,
    );
    if (observedScene !== undefined && observedItem !== undefined) {
      matchedSceneItemIds.add(sceneItemIdentity(observedScene.sceneUuid, observedItem.sceneItemId));
    }

    const dependencies: string[] = [];
    const sceneDependency = sceneCreateKeys.get(scene.id);
    if (sceneDependency !== undefined) dependencies.push(sceneDependency);
    if (materialization.createDependency !== undefined)
      dependencies.push(materialization.createDependency);

    let createPlacementKey: string | undefined;
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
    const placement =
      observedScene !== undefined && observedItem !== undefined
        ? ({
            kind: "existing",
            sceneUuid: observedScene.sceneUuid,
            sceneItemId: observedItem.sceneItemId,
          } as const)
        : ({ kind: "created", layerId: item.id, scene: sceneRef } as const);
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

    if (
      observedItem === undefined ? item.visible : observedItem.sceneItemEnabled !== item.visible
    ) {
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
  });
}

interface Materialization {
  readonly content: ObsContentRef;
  readonly sourceSize?: Size;
  readonly sourceCropScale?: Readonly<{ x: number; y: number }>;
  readonly observedSourceUuid?: string;
  readonly createDependency?: string;
}

function resolveMaterialization(
  item: CompiledItem,
  canvas: Size,
  managed: ManagedObservedIndex,
  plannedSources: ReadonlyMap<SourceId, PlannedSource>,
  sceneCreateKeys: ReadonlyMap<SceneId, string>,
): Materialization | undefined {
  if (item.content.kind === "source") {
    const source = plannedSources.get(item.content.sourceId);
    if (source === undefined) return undefined;
    const sourceSize = source.browserGeometry?.viewport ?? source.intrinsicSize;
    return {
      content: { kind: "input", sourceId: item.content.sourceId },
      ...(sourceSize === undefined ? {} : { sourceSize }),
      ...(source.browserGeometry === undefined
        ? {}
        : { sourceCropScale: source.browserGeometry.cropScale }),
      ...(source.observed === undefined ? {} : { observedSourceUuid: source.observed.inputUuid }),
      ...(source.createKey === undefined ? {} : { createDependency: source.createKey }),
    };
  }

  const observedScene = managed.scenes.get(item.content.sceneId);
  const createDependency = sceneCreateKeys.get(item.content.sceneId);
  return {
    content: { kind: "scene", sceneId: item.content.sceneId },
    sourceSize: canvas,
    ...(observedScene === undefined ? {} : { observedSourceUuid: observedScene.sceneUuid }),
    ...(createDependency === undefined ? {} : { createDependency }),
  };
}

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

function collectBrowserGeometries(
  scenes: readonly CompiledScene[],
  sources: ReadonlyMap<SourceId, CompiledSource>,
  diagnostics: ObsDiagnostic[],
): ReadonlyMap<SourceId, BrowserGeometry> {
  const result = new Map<SourceId, BrowserGeometry>();
  const conflicts = new Set<SourceId>();

  for (const scene of scenes) {
    for (const item of scene.items) {
      if (item.content.kind !== "source") continue;
      const source = sources.get(item.content.sourceId)?.definition;
      if (source?.kind !== "source:browser") continue;
      const geometry = realizeBrowserGeometry(source.viewport, item);
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
  }

  return result;
}

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

function toObsTransform(
  item: CompiledItem,
  sourceSize: Size | undefined,
  sourceCropScale: Readonly<{ x: number; y: number }> | undefined,
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

function scaleCrop(crop: Insets, scale: Readonly<{ x: number; y: number }> | undefined): Insets {
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
function objectContains(
  observed: Readonly<Record<string, unknown>>,
  desired: Readonly<Record<string, unknown>>,
): boolean {
  return Object.entries(desired).every(([key, value]) => containsValue(observed[key], value));
}

function containsValue(observed: unknown, desired: unknown): boolean {
  if (isRecord(observed) && isRecord(desired)) return objectContains(observed, desired);
  if (Array.isArray(observed) && Array.isArray(desired)) {
    return (
      observed.length === desired.length &&
      desired.every((value, index) => containsValue(observed[index], value))
    );
  }
  return equals(observed, desired);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sceneItemIdentity(sceneUuid: string, sceneItemId: number): string {
  return `${sceneUuid}:${String(sceneItemId)}`;
}
