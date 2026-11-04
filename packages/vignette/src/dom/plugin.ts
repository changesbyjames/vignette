import type { ShowEvent } from "../stream/messages.js";
import type { PluginContextBase, SourceOf, SourcePluginBase } from "../target/plugins.js";

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
