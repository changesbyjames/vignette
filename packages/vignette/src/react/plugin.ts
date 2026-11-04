import type { ReactNode } from "react";

import type { ItemOf } from "../core/define-layer.js";
import type { Item } from "../core/snapshot.js";
import type { LayerPluginBase, SourceOf, SourcePluginBase } from "../target/plugins.js";

/** What a source's `View` receives: the source, typed by its kind, and the item placing it. */
export interface ReactSourceViewProps<Def = unknown> {
  readonly source: SourceOf<Def>;
  /** The compiled item whose box the view renders in. */
  readonly item: Item;
}

/**
 * Renders one source kind in `@strangecyan/vignette/react`: a component that fills a box the stage sizes to
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

/** What a layer kind's `Place` receives: the item, its stacking order, and the item's content. */
export interface ReactPlaceProps<Def = unknown> {
  readonly item: ItemOf<Def>;
  readonly order: number;
  readonly children: ReactNode;
}

/**
 * Places items of one layer kind in `@strangecyan/vignette/react`. `Place` renders the item's box
 * where the stage would render a plain layer's; it owns the frame, visibility and opacity.
 * `Presence`, when given, wraps a scene's items so a removed item can play an exit before it
 * unmounts (e.g. Motion's `AnimatePresence`).
 */
export interface ReactLayerPlugin<Def = unknown> extends LayerPluginBase {
  readonly Place: (props: ReactPlaceProps<Def>) => ReactNode;
  readonly Presence?: (props: ReactPresenceProps) => ReactNode;
}

/** What a layer kind's `Presence` receives: a scene's item boxes. */
export interface ReactPresenceProps {
  readonly children: ReactNode;
}
