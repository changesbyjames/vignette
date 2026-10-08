import type {
  CompiledItem,
  CompiledScene,
  CompiledSnapshot,
  CompiledSource,
  Size,
  AnySourceDefinition,
} from "@strangecyan/vignette-core";

import type { DomRendererContext, DomRendererMap } from "./elements/index.js";
import { DomSourceRegistry } from "./source-registry.js";
import { applyItemFrame, px } from "./styles.js";

interface LayerRecord {
  readonly wrapper: HTMLDivElement;
  readonly contentHost: HTMLDivElement;
  contentKind: AnySourceDefinition["kind"] | "scene";
  sourceId?: string;
  nestedRecords?: Map<string, LayerRecord>;
}

export class DomScenePatcher {
  private readonly container: HTMLElement;
  private readonly records = new Map<string, LayerRecord>();
  private readonly sources: DomSourceRegistry;

  constructor(container: HTMLElement, renderers: DomRendererMap, context: DomRendererContext) {
    this.container = container;
    this.sources = new DomSourceRegistry(container, renderers, context);
  }

  patch(
    snapshot: CompiledSnapshot,
    scene: CompiledScene,
    resolvedUrls: ReadonlyMap<string, string>,
  ): void {
    this.sources.reconcile(snapshot.sources);
    patchScene(this.container, this.records, this.sources, snapshot, scene, resolvedUrls, scene.id);
  }

  dispose(): void {
    this.sources.dispose();
    disposeRecords(this.records);
    this.container.replaceChildren();
  }
}

/** Reuse records by layer identity, patch their content in snapshot order, and release absent placements. */
function patchScene(
  container: HTMLElement,
  records: Map<string, LayerRecord>,
  sourceRegistry: DomSourceRegistry,
  snapshot: CompiledSnapshot,
  scene: CompiledScene,
  resolvedUrls: ReadonlyMap<string, string>,
  path: string,
): void {
  const desired = new Set(scene.items.map((item) => item.id));
  const sources = new Map(snapshot.sources.map((source) => [source.id, source]));
  const scenes = new Map(snapshot.scenes.map((candidate) => [candidate.id, candidate]));

  for (const [order, item] of scene.items.entries()) {
    const record = ensureRecord(
      container.ownerDocument,
      records,
      sourceRegistry,
      item,
      sources,
      desired,
    );
    applyItemFrame(record.wrapper, item);
    record.wrapper.style.zIndex = String(order);
    record.wrapper.dataset.vignetteLayer = item.id;
    record.wrapper.dataset.vignettePath = `${path}/${item.id}`;
    mountRecord(container, record.wrapper);

    if (item.content.kind === "source") {
      const source = sources.get(item.content.sourceId);
      if (source === undefined)
        throw new Error(`Compiled source '${item.content.sourceId}' is missing.`);
      patchSource(record, sourceRegistry, source, item, resolvedUrls.get(source.id));
    } else {
      const nestedScene = scenes.get(item.content.sceneId);
      if (nestedScene === undefined)
        throw new Error(`Compiled scene '${item.content.sceneId}' is missing.`);
      patchNestedScene(
        record,
        sourceRegistry,
        snapshot,
        nestedScene,
        item,
        resolvedUrls,
        `${path}/${item.id}`,
      );
    }
  }

  for (const [key, record] of records) {
    if (desired.has(key)) continue;
    deactivateRecord(record);
    if (releaseRecord(record, sourceRegistry)) {
      disposeRecord(record);
      records.delete(key);
    }
  }
}

/** Reuse matching content kinds; otherwise release the old content before constructing its replacement wrapper. */
function ensureRecord(
  document: Document,
  records: Map<string, LayerRecord>,
  sourceRegistry: DomSourceRegistry,
  item: CompiledItem,
  sources: ReadonlyMap<string, CompiledSource>,
  desired: ReadonlySet<string>,
): LayerRecord {
  const expectedKind = contentKind(item, sources);

  const existing = records.get(item.id);
  if (existing?.contentKind === expectedKind) return existing;
  if (existing !== undefined) {
    if (!releaseRecord(existing, sourceRegistry)) sourceRegistry.disposeFrom(existing.contentHost);
    disposeRecord(existing);
  }

  const retained =
    expectedKind === "source:browser" ? reuseBrowserRecord(records, item, desired) : undefined;
  if (retained !== undefined) return retained;

  const wrapper = document.createElement("div");
  const contentHost = document.createElement("div");
  Object.assign(wrapper.style, {
    position: "absolute",
    overflow: "hidden",
    pointerEvents: "none",
    boxSizing: "border-box",
  });
  Object.assign(contentHost.style, {
    position: "absolute",
    overflow: "hidden",
    pointerEvents: "none",
  });
  wrapper.append(contentHost);

  const record: LayerRecord = { wrapper, contentHost, contentKind: expectedKind };
  records.set(item.id, record);
  return record;
}

/** Transfer an obsolete browser placement's connected wrapper without resetting its document. */
function reuseBrowserRecord(
  records: Map<string, LayerRecord>,
  item: CompiledItem,
  desired: ReadonlySet<string>,
): LayerRecord | undefined {
  if (item.content.kind !== "source") return undefined;
  for (const [previousId, previous] of records) {
    if (
      desired.has(previousId) ||
      previous.contentKind !== "source:browser" ||
      previous.sourceId !== item.content.sourceId
    )
      continue;
    // append() would reset the iframe in browsers without moveBefore(). Keep its host
    // connected while changing the layer identity and compiled placement geometry.
    records.delete(previousId);
    records.set(item.id, previous);
    return previous;
  }
  return undefined;
}

/** Release incompatible nested or prior source content before mounting the current source definition. */
function patchSource(
  record: LayerRecord,
  sourceRegistry: DomSourceRegistry,
  source: CompiledSource,
  item: CompiledItem,
  resolvedUrl: string | undefined,
): void {
  if (record.nestedRecords !== undefined) {
    releaseRecords(record.nestedRecords, sourceRegistry);
    disposeRecords(record.nestedRecords);
    delete record.nestedRecords;
  }

  if (record.sourceId !== undefined && record.sourceId !== source.id) {
    if (!sourceRegistry.releaseFrom(record.contentHost)) {
      sourceRegistry.disposeFrom(record.contentHost);
    }
  }

  const view = sourceRegistry.mount(record.contentHost, source.definition, item, resolvedUrl);
  record.sourceId = source.id;

  applyContentPlacement(record, view.element, source.intrinsicSize, item);
}

function patchNestedScene(
  record: LayerRecord,
  sourceRegistry: DomSourceRegistry,
  snapshot: CompiledSnapshot,
  scene: CompiledScene,
  item: CompiledItem,
  resolvedUrls: ReadonlyMap<string, string>,
  path: string,
): void {
  if (record.sourceId !== undefined) {
    if (!sourceRegistry.releaseFrom(record.contentHost)) {
      sourceRegistry.disposeFrom(record.contentHost);
    }
    delete record.sourceId;
  }

  let nestedRecords = record.nestedRecords;
  if (nestedRecords === undefined) {
    nestedRecords = new Map();
    record.nestedRecords = nestedRecords;
    record.contentHost.replaceChildren();
  }

  Object.assign(record.contentHost.style, {
    left: "0",
    top: "0",
    width: px(snapshot.canvas.width),
    height: px(snapshot.canvas.height),
    transform: `scale(${String(item.frame.width / snapshot.canvas.width)}, ${String(item.frame.height / snapshot.canvas.height)})`,
    transformOrigin: "top left",
  });
  patchScene(
    record.contentHost,
    nestedRecords,
    sourceRegistry,
    snapshot,
    scene,
    resolvedUrls,
    path,
  );
}

/** Derive the content transform from compiled destination and crop geometry rather than performing CSS layout. */
function applyContentPlacement(
  record: LayerRecord,
  element: HTMLElement,
  intrinsicSize: Size | undefined,
  item: CompiledItem,
): void {
  const placement = item.placement;
  const destination = placement?.destination ?? item.frame;
  Object.assign(record.contentHost.style, {
    left: px(destination.x - item.frame.x),
    top: px(destination.y - item.frame.y),
    width: px(destination.width),
    height: px(destination.height),
    transform: "",
    transformOrigin: "",
  });

  Object.assign(element.style, {
    position: "absolute",
    border: "0",
    margin: "0",
    maxWidth: "none",
    maxHeight: "none",
    pointerEvents: "none",
  });

  if (placement === undefined || intrinsicSize === undefined) {
    Object.assign(element.style, { left: "0", top: "0", width: "100%", height: "100%" });
    return;
  }

  const crop = placement.sourceCrop;
  const effectiveWidth = intrinsicSize.width - crop.left - crop.right;
  const effectiveHeight = intrinsicSize.height - crop.top - crop.bottom;
  if (effectiveWidth <= 0 || effectiveHeight <= 0) return;
  const scaleX = destination.width / effectiveWidth;
  const scaleY = destination.height / effectiveHeight;
  Object.assign(element.style, {
    left: px(-crop.left * scaleX),
    top: px(-crop.top * scaleY),
    width: px(intrinsicSize.width * scaleX),
    height: px(intrinsicSize.height * scaleY),
  });
}

function disposeRecords(records: Map<string, LayerRecord>): void {
  for (const record of records.values()) disposeRecord(record);
  records.clear();
}

function disposeRecord(record: LayerRecord): void {
  if (record.nestedRecords !== undefined) disposeRecords(record.nestedRecords);
  record.wrapper.remove();
}

function deactivateRecord(record: LayerRecord): void {
  record.wrapper.style.display = "none";
  delete record.wrapper.dataset.vignetteLayer;
  delete record.wrapper.dataset.vignettePath;
}

function releaseRecord(record: LayerRecord, sourceRegistry: DomSourceRegistry): boolean {
  const ownSourceReleased = sourceRegistry.releaseFrom(record.contentHost);
  const nestedSourcesReleased =
    record.nestedRecords === undefined
      ? true
      : releaseRecords(record.nestedRecords, sourceRegistry);
  return ownSourceReleased && nestedSourcesReleased;
}

function releaseRecords(
  records: Map<string, LayerRecord>,
  sourceRegistry: DomSourceRegistry,
): boolean {
  let released = true;
  for (const record of records.values()) {
    if (!releaseRecord(record, sourceRegistry)) released = false;
  }
  return released;
}

/** Use state-preserving DOM moves when available for connected nodes; otherwise append the wrapper. */
function mountRecord(container: HTMLElement, wrapper: HTMLDivElement): void {
  if (wrapper.parentNode === container) return;
  if (wrapper.isConnected && container.isConnected && container.moveBefore !== undefined) {
    container.moveBefore(wrapper, null);
  } else {
    container.append(wrapper);
  }
}

/** Resolve content identity before reusing or replacing a layer DOM record. */
function contentKind(
  item: CompiledItem,
  sources: ReadonlyMap<string, CompiledSource>,
): AnySourceDefinition["kind"] | "scene" {
  if (item.content.kind === "scene") {
    return "scene";
  } else {
    const source = sources.get(item.content.sourceId);
    if (source === undefined)
      throw new Error(`Compiled source '${item.content.sourceId}' is missing.`);
    return source.definition.kind;
  }
}
