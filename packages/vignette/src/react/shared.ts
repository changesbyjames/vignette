import type { Item } from "../core/snapshot.js";

/** Where a shared source currently renders, for its view. */
export interface SharedPlacement {
  /** The item of the stage box holding the source, if any stage shows it. */
  readonly item?: Item;
  /** Counts how often the source entered a shown stage after being shown by none. */
  readonly appearances: number;
}

/** One stage box that wants to show a shared source. */
interface Claim {
  readonly box: HTMLElement;
  item: Item;
}

/**
 * Keeps one DOM element per shared source alive for the stream's lifetime. Each shared source's
 * view renders once, through a portal, into its slot element; stage boxes claim the slot, which
 * moves into the newest claimant with `moveBefore` (so an iframe or video keeps running) and
 * returns to the hidden host when no box holds it.
 */
export interface SharedSources {
  /** Sets the hidden element unclaimed slots wait in. */
  readonly attach: (host: HTMLElement | null) => void;
  /** The source's slot element, created on first use. */
  slot(id: string, document: Document): HTMLElement;
  /** Removes the slots of sources that are no longer shared. */
  retain(ids: ReadonlySet<string>): void;
  /** Moves the source's slot into `box` until it is released or another box claims it. */
  claim(id: string, box: HTMLElement, item: Item): void;
  /** Updates the item of a box's claim without moving anything. */
  place(id: string, box: HTMLElement, item: Item): void;
  /** Gives the slot back to the previous claimant, or the hidden host. */
  release(id: string, box: HTMLElement): void;
  readonly placement: (id: string) => SharedPlacement | undefined;
  readonly subscribe: (listener: () => void) => () => void;
}

/** Creates the shared-source registry of one `<Stream>`. */
export function createSharedSources(): SharedSources {
  const slots = new Map<string, HTMLElement>();
  const claims = new Map<string, Claim[]>();
  const placements = new Map<string, SharedPlacement>();
  /** Sources shown by no box. A release only counts at the end of a commit, see `release`. */
  const hidden = new Set<string>();
  const listeners = new Set<() => void>();
  let host: HTMLElement | null = null;

  /** Recomputes a source's placement from its newest claim and notifies the views. */
  function publish(id: string): void {
    const owner = claims.get(id)?.at(-1);
    const appearances = placements.get(id)?.appearances ?? 0;
    placements.set(id, { item: owner?.item, appearances });
    for (const listener of listeners) listener();
  }

  /** Where an unclaimed slot waits: the hidden host, or nowhere before the host mounts. */
  function park(slot: HTMLElement): void {
    if (host === null) slot.remove();
    else move(host, slot);
  }

  function slotFor(id: string, document: Document): HTMLElement {
    let slot = slots.get(id);
    if (slot === undefined) {
      slot = document.createElement("div");
      slot.dataset.vignetteShared = id;
      Object.assign(slot.style, { position: "absolute", inset: "0", overflow: "hidden" });
      slots.set(id, slot);
      hidden.add(id);
      if (host !== null) host.append(slot);
    }
    return slot;
  }

  return {
    attach(element) {
      // Slots claimed before the host mounted stay put; unclaimed ones move into the host.
      host = element;
      if (host === null) return;
      for (const [id, slot] of slots) if ((claims.get(id) ?? []).length === 0) park(slot);
    },
    slot: slotFor,
    retain(ids) {
      for (const [id, slot] of slots) {
        if (ids.has(id)) continue;
        slot.remove();
        slots.delete(id);
        claims.delete(id);
        placements.delete(id);
        hidden.delete(id);
      }
    },
    claim(id, box, item) {
      // The newest claim owns the slot; a source no box showed counts a new appearance.
      const slot = slotFor(id, box.ownerDocument);
      const list = claims.get(id) ?? [];
      claims.set(id, [...list.filter((claim) => claim.box !== box), { box, item }]);
      move(box, slot);
      if (hidden.delete(id)) {
        placements.set(id, { item, appearances: (placements.get(id)?.appearances ?? 0) + 1 });
      }
      publish(id);
    },
    place(id, box, item) {
      const claim = claims.get(id)?.find((candidate) => candidate.box === box);
      if (claim === undefined || claim.item === item) return;
      claim.item = item;
      publish(id);
    },
    release(id, box) {
      const slot = slots.get(id);
      const list = (claims.get(id) ?? []).filter((claim) => claim.box !== box);
      claims.set(id, list);
      const owner = list.at(-1);
      if (slot !== undefined && slot.parentNode === box) {
        if (owner === undefined) park(slot);
        else move(owner.box, slot);
      }
      // A scene switch releases and re-claims in one commit; only a source still unclaimed after
      // the commit left the shown scenes, so `restartOnShow` matches the DOM target.
      if (owner === undefined) {
        queueMicrotask(() => {
          if ((claims.get(id) ?? []).length === 0 && slots.has(id)) hidden.add(id);
        });
      }
      publish(id);
    },
    placement: (id) => placements.get(id),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Moves an element without resetting it where the browser supports `moveBefore` and both ends
 * are connected; elsewhere `append` reloads iframes and media, the documented fallback.
 */
function move(parent: HTMLElement, element: HTMLElement): void {
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
