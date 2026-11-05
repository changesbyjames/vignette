import type { SourcePropsOf } from "@strangecyan/vignette";

import type { Moq } from "./index.js";

/** Validated props of a `moq` source. */
export type MoqProps = SourcePropsOf<typeof Moq>;

/** The rendition name; the player may also keep sizing constraints in this target. */
interface MoqRenditionTarget {
  readonly name?: string;
}

/** The part of the player's rendition signal the adapter consumes. */
interface MoqRenditionControl {
  update(update: (current: MoqRenditionTarget | undefined) => MoqRenditionTarget | undefined): void;
}

/** The public controls, present once the element is upgraded. */
interface MoqWatchControls {
  readonly target: MoqRenditionControl;
}

/** A `<moq-watch>` element, upgraded or not. */
export interface MoqWatchElement extends HTMLElement {
  readonly controls?: MoqWatchControls;
}

let registration: Promise<void> | undefined = undefined;

/** Registers `<moq-watch>` once; resolves at once where it is already defined. */
export async function registerMoqWatch(): Promise<void> {
  if (globalThis.customElements?.get("moq-watch") !== undefined) return;
  registration ??= import("@moq/watch/element").then(() => undefined);
  await registration;
}

/** Appends the canvas `<moq-watch>` draws into. */
export function appendMoqCanvas(watch: HTMLElement): void {
  const canvas = watch.ownerDocument.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  watch.append(canvas);
}

/** Maps a source's props onto `<moq-watch>`'s attributes and rendition selector. */
export function applyMoqProps(watch: MoqWatchElement, props: MoqProps): void {
  watch.setAttribute("url", props.url);
  watch.setAttribute("name", props.broadcast);
  watch.setAttribute("delay", `${String(props.latencyMs)}ms`);
  watch.toggleAttribute("muted", !props.audio);
  watch.setAttribute("visible", visibility(props));
  watch.dataset.vignetteMoqQuality = props.quality;
  const name = props.quality === "auto" ? undefined : props.quality;
  watch.controls?.target.update((current) =>
    current?.name === name ? current : { ...current, name },
  );
}

/** Detaches `<moq-watch>` from its broadcast. */
export function clearMoqProps(watch: HTMLElement): void {
  watch.removeAttribute("url");
  watch.removeAttribute("name");
}

/** `never` without video; otherwise download only on screen unless `disableWhenHidden` is off. */
function visibility(props: MoqProps): string {
  if (!props.video) return "never";
  return props.disableWhenHidden ? "0px" : "always";
}
