import type { SourcePropsOf } from "vignette";

import type { Moq } from "./index.js";

/** Validated props of a `moq` source. */
export type MoqProps = SourcePropsOf<typeof Moq>;

/** The parts of `@moq/watch`'s element this package drives beyond attributes. */
interface MoqVideoTarget {
  readonly name?: string;
}

/** The rendition `<moq-watch>` downloads. */
interface MoqVideoSourceTarget {
  update(update: (current: MoqVideoTarget | undefined) => MoqVideoTarget): void;
}

/** `<moq-watch>`'s video source. */
interface MoqVideoSource {
  readonly target: MoqVideoSourceTarget;
}

/** `<moq-watch>`'s video pipeline. */
interface MoqVideo {
  readonly source: MoqVideoSource;
}

/** `<moq-watch>`'s player, present once the element is upgraded. */
interface MoqWatchBackend {
  readonly video: MoqVideo;
}

/** A `<moq-watch>` element, upgraded or not. */
export interface MoqWatchElement extends HTMLElement {
  readonly backend?: MoqWatchBackend;
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
  watch.setAttribute("latency", String(props.latencyMs));
  watch.toggleAttribute("muted", !props.audio);
  watch.setAttribute("visible", visibility(props));
  watch.dataset.vignetteMoqQuality = props.quality;
  const name = props.quality === "auto" ? undefined : props.quality;
  watch.backend?.video.source.target.update((current) => ({ ...current, name }));
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
