import type { AnySourceDefinition, CompiledItem } from "@cbj/vignette-core";

/** One live DOM element rendering one source instance. */
export interface DomSourceView {
  readonly element: HTMLElement;
  update(source: AnySourceDefinition, item: CompiledItem, resolvedUrl?: string): void;
  dispose(): void;
}

/**
 * Renders one source kind in the DOM target. Extension packages export a renderer and pass it
 * to the runtime through `DOMRuntimeOptions.extensions`.
 */
export interface DomSourceRenderer<Source extends AnySourceDefinition = AnySourceDefinition> {
  readonly kind: Source["kind"];
  /** One-time document preparation (e.g. registering custom elements) before first render. */
  prepare?(document: Document): Promise<void>;
  create(document: Document): DomSourceView;
  /** Whether the live element should be parked, not disposed, when it leaves the active scene. */
  retainWhenHidden?(source: Source): boolean;
}
