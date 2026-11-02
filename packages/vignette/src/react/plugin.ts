import type { ReactNode } from "react";

import type { Item } from "../core/snapshot.js";
import type { SourceOf, SourcePluginBase } from "../target/plugins.js";

/** What a source's `View` receives: the source, typed by its kind, and the item placing it. */
export interface ReactSourceViewProps<Def = unknown> {
  readonly source: SourceOf<Def>;
  /** The compiled item whose box the view renders in. */
  readonly item: Item;
}

/**
 * Renders one source kind in `vignette/react`: a component that fills a box the stage sizes to
 * `source.size` and scales into the item. Hooks, `use()`, Suspense and effects all work. `Def` is
 * the source component, e.g. `ReactSourcePlugin<typeof Moq>`, which types `source.props`.
 */
export interface ReactSourcePlugin<Def = unknown> extends SourcePluginBase {
  readonly View: SourceView<Def>;
}

/** Declared as a method so its props are bivariant, like React's own event handler types. */
interface SourceViewSignature<Def> {
  View(props: ReactSourceViewProps<Def>): ReactNode;
}

/**
 * A source view component. Bivariant in `Def`, so `ReactSourcePlugin<typeof Moq>` is assignable
 * to the `ReactSourcePlugin` that `<Stream sources>` takes.
 */
type SourceView<Def> = SourceViewSignature<Def>["View"];
