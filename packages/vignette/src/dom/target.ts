import type { Item, Snapshot, SnapshotScene, Source } from "../core/snapshot.js";
import { createTarget, type Target } from "../target/kernel.js";
import { objectUrlAssetStore } from "./asset-store.js";
import type { DomHandle, DomLayerPlugin, DomPluginContext, DomSourcePlugin } from "./plugin.js";
import { applyContentPlacement } from "./placement.js";
import { browserDom } from "./sources/browser.js";
import { colorDom } from "./sources/color.js";
import { frameDom } from "./sources/frame.js";
import { imageDom } from "./sources/image.js";
import { textDom } from "./sources/text.js";
import { videoDom } from "./sources/video.js";
import { DomStage } from "./stage.js";
import { applyItemFrame } from "./styles.js";

/** Options of {@link domTarget}. */
export interface DomTargetOptions {
  /** The scene to show. Defaults to the snapshot's `activeScene`, then its first scene. */
  readonly scene?: string;
  /** Plugins for source kinds; later entries win per kind, including over the built-ins. */
  readonly sources?: readonly DomSourcePlugin[];
  /** Plugins for layer kinds; a plain `<Layer>` needs none. Later entries win per kind. */
  readonly layers?: readonly DomLayerPlugin[];
  /** Registers the built-in color, image, video, browser, frame and text plugins. Default `true`. */
  readonly builtins?: boolean;
}

/** The built-in DOM plugins, registered unless `builtins: false`. */
const BUILTIN_PLUGINS: readonly DomSourcePlugin[] = [
  colorDom,
  imageDom,
  textDom,
  videoDom,
  browserDom,
  frameDom,
];

/**
 * Renders one scene of a stream into `container` as positioned elements, for pages without React.
 * Layout comes from the snapshot's compiled frames; the container's size only scales the canvas.
 * Each source is one element for its whole life, so a shared source keeps its page, playback or
 * connection across scene switches: it moves between layers with `moveBefore` where the browser
 * has it, and waits in a hidden container while the shown scene does not place it.
 */
export function domTarget(container: HTMLElement, options: DomTargetOptions = {}): Target {
  const document = container.ownerDocument;
  const layers = new Map((options.layers ?? []).map((plugin) => [plugin.kind, plugin]));
  const renderer = createSceneRenderer(container, options.scene, layers);
  return createTarget<DomHandle, DomPluginContext>({
    kind: "dom",
    sources: [...(options.builtins === false ? [] : BUILTIN_PLUGINS), ...(options.sources ?? [])],
    layers: [...layers.values()],
    assets: objectUrlAssetStore(),
    context: (base) => ({ ...base, document }),
    update: renderer.update,
    dispose: renderer.dispose,
  });
}

/** The wrapper of one item, keyed by layer ID; `content` is the placed box inside it. */
interface LayerRecord {
  readonly wrapper: HTMLDivElement;
  readonly content: HTMLDivElement;
  sourceId: string;
  /** The item last placed, for layer plugins. */
  item?: Item;
}

/** Renders snapshots into the stage. */
interface SceneRenderer {
  readonly update: (snapshot: Snapshot, handles: ReadonlyMap<string, DomHandle>) => void;
  readonly dispose: () => void;
}

function createSceneRenderer(
  container: HTMLElement,
  sceneId: string | undefined,
  layerPlugins: ReadonlyMap<string, DomLayerPlugin>,
): SceneRenderer {
  const document = container.ownerDocument;
  const stage = new DomStage(container);
  const parking = document.createElement("div");
  parking.dataset.vignetteParking = "";
  Object.assign(parking.style, {
    position: "absolute",
    width: "0",
    height: "0",
    overflow: "hidden",
    visibility: "hidden",
    pointerEvents: "none",
  });
  stage.viewport.append(parking);
  let layers = new Map<string, LayerRecord>();
  /** Boxes a layer plugin is still releasing; a returning item takes its box back. */
  const leaving = new Map<string, LayerRecord>();
  let shown = new Set<string>();

  /**
   * Places every item of the shown scene, then parks the handles it does not place, then drops
   * wrappers of layers that are gone. Placing first keeps every moved element connected, which
   * `moveBefore` needs to preserve its state. A wrapper whose layer is gone but whose source is
   * placed by a new layer is adopted by that layer, so the element does not move at all.
   */
  function update(snapshot: Snapshot, handles: ReadonlyMap<string, DomHandle>): void {
    stage.update(snapshot);
    const scene = selectScene(snapshot, sceneId);
    const live = new Set<Element>([...handles.values()].map((handle) => handle.element));
    const stale = new Map(layers);
    const next = new Map<string, LayerRecord>();
    const placed = new Set<string>();
    const sources = new Map(snapshot.sources.map((source) => [source.id, source]));
    for (const [order, item] of (scene?.items ?? []).entries()) {
      const record = takeLayer(stale, leaving, item, document);
      next.set(item.id, record);
      placeItem(record, item, order);
      removeDisposed(record.content, live);
      const shows = placeContent(
        record,
        item,
        handles.get(item.sourceId),
        sources.get(item.sourceId),
      );
      if (shows) placed.add(item.sourceId);
    }
    park(next, handles, live);
    for (const [id, record] of stale) release(id, record);
    layers = next;
    for (const id of placed) {
      if (!shown.has(id)) handles.get(id)?.activate?.();
    }
    shown = placed;
  }

  /** Puts the item's box on the stage: the kind's plugin places it, else the stage does. */
  function placeItem(record: LayerRecord, item: Item, order: number): void {
    const plugin = layerPlugins.get(item.kind);
    if (plugin === undefined) placeLayer(stage.stage, record, item, order);
    else {
      attachLayer(stage.stage, record, item);
      plugin.place(item, { box: record.wrapper, order, previous: record.item });
    }
    record.item = item;
  }

  /** Removes a gone layer's box, after its layer plugin (if any) has released it. */
  function release(id: string, record: LayerRecord): void {
    const plugin = record.item === undefined ? undefined : layerPlugins.get(record.item.kind);
    if (plugin === undefined || record.item === undefined) {
      record.wrapper.remove();
      return;
    }
    leaving.set(id, record);
    void plugin.remove(record.item, { box: record.wrapper, order: 0 }).then(() => {
      // The item may have come back and taken its box meanwhile.
      if (leaving.get(id) !== record) return;
      leaving.delete(id);
      record.wrapper.remove();
    });
  }

  /** Moves every handle the shown scene does not place into the hidden parking container. */
  function park(
    placedLayers: ReadonlyMap<string, LayerRecord>,
    handles: ReadonlyMap<string, DomHandle>,
    live: ReadonlySet<Element>,
  ): void {
    for (const [id, handle] of handles) {
      if (!isPlaced(placedLayers, id, handle) && !isPlaced(leaving, id, handle)) {
        moveInto(parking, handle.element);
      }
    }
    removeDisposed(parking, live);
  }

  return {
    update,
    dispose() {
      layers.clear();
      stage.dispose();
    },
  };
}

/** Puts the handle's element in the layer, sized and fitted; false for a placeholder. */
function placeContent(
  record: LayerRecord,
  item: Item,
  handle: DomHandle | undefined,
  source: Source | undefined,
): boolean {
  if (handle === undefined || source === undefined) return false;
  moveInto(record.content, handle.element);
  applyContentPlacement(record.content, handle.element, source.size, item);
  return item.visible;
}

/** The scene option, else the snapshot's active scene, else its first scene. */
function selectScene(snapshot: Snapshot, sceneId: string | undefined): SnapshotScene | undefined {
  const id = sceneId ?? snapshot.activeScene ?? snapshot.scenes[0]?.id;
  if (id === undefined) return undefined;
  const scene = snapshot.scenes.find((candidate) => candidate.id === id);
  if (scene === undefined)
    throw new Error(`Scene "${id}" is not in snapshot ${String(snapshot.revision)}.`);
  return scene;
}

/** The item's own wrapper, else a gone layer's wrapper holding its source, else a new one. */
function takeLayer(
  stale: Map<string, LayerRecord>,
  leaving: Map<string, LayerRecord>,
  item: Item,
  document: Document,
): LayerRecord {
  const own = stale.get(item.id) ?? leaving.get(item.id);
  stale.delete(item.id);
  leaving.delete(item.id);
  return own ?? adopt(stale, item.sourceId) ?? createLayer(document);
}

/** Takes a gone layer's wrapper that already holds this source's element. */
function adopt(stale: Map<string, LayerRecord>, sourceId: string): LayerRecord | undefined {
  for (const [id, record] of stale) {
    if (record.sourceId !== sourceId) continue;
    stale.delete(id);
    return record;
  }
  return undefined;
}

function createLayer(document: Document): LayerRecord {
  const wrapper = document.createElement("div");
  const content = document.createElement("div");
  Object.assign(wrapper.style, { position: "absolute", overflow: "hidden", pointerEvents: "none" });
  Object.assign(content.style, { position: "absolute", overflow: "hidden", pointerEvents: "none" });
  wrapper.append(content);
  return { wrapper, content, sourceId: "" };
}

function placeLayer(stage: HTMLElement, record: LayerRecord, item: Item, order: number): void {
  applyItemFrame(record.wrapper, item);
  record.wrapper.style.zIndex = String(order);
  attachLayer(stage, record, item);
}

/** Labels the box with its item and puts it on the stage; the frame is set separately. */
function attachLayer(stage: HTMLElement, record: LayerRecord, item: Item): void {
  record.sourceId = item.sourceId;
  record.wrapper.dataset.vignetteLayer = item.id;
  record.wrapper.dataset.vignetteSource = item.sourceId;
  if (record.wrapper.parentNode !== stage) stage.append(record.wrapper);
}

/** Removes elements whose handle was disposed; a plugin's `dispose` need not detach them. */
function removeDisposed(content: HTMLElement, live: ReadonlySet<Element>): void {
  for (const child of [...content.children]) if (!live.has(child)) child.remove();
}

/** Whether a layer of the shown scene holds the handle's element. */
function isPlaced(
  layers: ReadonlyMap<string, LayerRecord>,
  sourceId: string,
  handle: DomHandle,
): boolean {
  for (const record of layers.values()) {
    if (record.sourceId === sourceId && handle.element.parentNode === record.content) return true;
  }
  return false;
}

/**
 * Moves an element without resetting it where the browser supports `moveBefore` and both ends
 * are connected; elsewhere `append` reloads iframes and media, which is the documented fallback.
 */
function moveInto(parent: HTMLElement, element: HTMLElement): void {
  if (element.parentNode === parent) return;
  if (element.isConnected && parent.isConnected && "moveBefore" in parent) {
    try {
      parent.moveBefore(element, null);
      return;
    } catch {
      // Fall through to `append`, which always succeeds within one document.
    }
  }
  parent.append(element);
}
