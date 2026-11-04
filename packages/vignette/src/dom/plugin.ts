import type { ShowEvent } from "../stream/messages.js";
import type { ItemOf } from "../core/define-layer.js";
import type { Item } from "../core/snapshot.js";
import type {
  LayerPluginBase,
  PluginContextBase,
  SourceOf,
  SourcePluginBase,
} from "../target/plugins.js";

/** What a DOM plugin receives: the base context plus the stage's owner document. */
export interface DomPluginContext extends PluginContextBase {
  readonly document: Document;
}

/**
 * One live source in the DOM target: an element the target positions in every layer that places
 * the source, and the lifetime members the kernel calls. `Def` is the source component, e.g.
 * `DomHandle<typeof Moq>`, which types `update`'s props.
 */
export interface DomHandle<Def = unknown> {
  readonly element: HTMLElement;
  /** The same source ID arrived with changed props or size. */
  update?(source: SourceOf<Def>): void | Promise<void>;
  /** The source ID is gone, or the target is disposed. */
  dispose?(): void | Promise<void>;
  /** A show event addressed to this source, or to no source in particular. */
  event?(event: ShowEvent): void | Promise<void>;
  /** The element entered the shown scene, after being unplaced or placed only in other scenes. */
  activate?(): void;
}

/**
 * Renders one source kind in the DOM target. `create` runs when a source ID first appears; it may
 * be asynchronous, and the source shows as `preparing` meanwhile.
 */
export interface DomSourcePlugin<Def = unknown> extends SourcePluginBase {
  /** Runs once before the plugin's first `create`, e.g. to import a custom element. */
  load?(): Promise<void>;
  create(
    source: SourceOf<Def>,
    context: DomPluginContext,
  ): DomHandle<Def> | Promise<DomHandle<Def>>;
}

/** What a DOM layer plugin receives for one placement of an item of its kind. */
export interface DomPlacementContext {
  /** The item's wrapper: absolutely positioned in canvas pixels; the plugin sets its frame. */
  readonly box: HTMLElement;
  /** Stacking order within the scene. */
  readonly order: number;
  /** The item this plugin last placed in the same box, if any. */
  readonly previous?: Item;
}

/**
 * Places items of one layer kind in the DOM target. The target creates each item's box and puts
 * the source's element inside it; the plugin owns the box's frame, visibility and opacity, and is
 * asked to release it (play an exit) before the box is removed.
 */
export interface DomLayerPlugin<Def = unknown> extends LayerPluginBase {
  place(item: ItemOf<Def>, context: DomPlacementContext): void;
  /** The item is gone from the shown scene; resolves when the box may be removed. */
  remove(item: ItemOf<Def>, context: DomPlacementContext): Promise<void>;
}
