import { Suspense, useSyncExternalStore, type ReactNode } from "react";

import type { Item, Snapshot } from "../core/snapshot.js";
import { AppearanceContext, useStreamContext } from "./context.js";
import { useSnapshot } from "./hooks.js";
import { sourceBoxStyle } from "./placement.js";
import type { ReactSourceViewProps } from "./plugin.js";

/**
 * Renders a source with its kind's plugin, in a box at the source's size scaled into the item.
 * A kind without a plugin renders nothing; the stream's status already reports it.
 */
export function SourceView({ source, item }: ReactSourceViewProps): ReactNode {
  const { plugins } = useStreamContext();
  const plugin = plugins.get(source.kind);
  if (plugin === undefined) return null;
  return (
    <div data-vignette-source={source.id} style={sourceBoxStyle(source, item)}>
      <plugin.View source={source} item={item} />
    </div>
  );
}

/** Props of {@link SharedSourceView}. */
export interface SharedSourceViewProps {
  readonly id: string;
}

/**
 * A shared source's single view, rendered by `<Stream>` into the source's slot. It follows the
 * item of whichever stage box holds the slot, else the first item that places the source.
 */
export function SharedSourceView({ id }: SharedSourceViewProps): ReactNode {
  const { client, sources } = useStreamContext();
  const snapshot = useSnapshot();
  const read = () => client.shared.placement(id);
  const placement = useSyncExternalStore(client.shared.subscribe, read, read);
  const source = sources.get(id);
  const item = placement?.item ?? firstItem(snapshot, id);
  if (source === undefined || item === undefined) return null;
  return (
    <AppearanceContext value={placement?.appearances ?? 0}>
      <Suspense fallback={null}>
        <SourceView source={source} item={item} />
      </Suspense>
    </AppearanceContext>
  );
}

/** The first item of any scene that places the source, for a source no stage shows yet. */
function firstItem(snapshot: Snapshot | undefined, sourceId: string): Item | undefined {
  for (const scene of snapshot?.scenes ?? []) {
    const item = scene.items.find((candidate) => candidate.sourceId === sourceId);
    if (item !== undefined) return item;
  }
  return undefined;
}
