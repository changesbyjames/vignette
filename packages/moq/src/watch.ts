import type { SourcePropsOf } from "@strangecyan/vignette";

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

/** A `@moq/signals` value the bridge reads and watches. */
interface MoqSignal<T> {
  peek(): T;
  subscribe(listener: (value: T) => void): () => void;
}

/** What `<moq-watch>`'s audio decoder outputs: the node its samples leave from. */
interface MoqAudioOutput {
  readonly root: MoqSignal<AudioNode | undefined>;
}

/** `<moq-watch>`'s audio decoder. */
interface MoqAudio {
  readonly out: MoqAudioOutput;
}

/** `<moq-watch>`'s player, present once the element is upgraded. */
interface MoqWatchBackend {
  readonly video: MoqVideo;
  readonly audio: MoqAudio;
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

/** Appends the canvas `<moq-watch>` draws into, and returns it. */
export function appendMoqCanvas(watch: HTMLElement): HTMLCanvasElement {
  const canvas = watch.ownerDocument.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  watch.append(canvas);
  return canvas;
}

/**
 * Maps a source's props onto `<moq-watch>`'s attributes and rendition selector. `audio` says
 * whether the source has an audio channel: without one the element is muted, which also stops
 * the download; with one its own output is silent, because the target's mixer plays it.
 */
export function applyMoqProps(watch: MoqWatchElement, props: MoqProps, audio: boolean): void {
  watch.setAttribute("url", props.url);
  watch.setAttribute("name", props.broadcast);
  watch.setAttribute("latency", String(props.latencyMs));
  watch.toggleAttribute("muted", !audio);
  watch.setAttribute("volume", "0");
  watch.setAttribute("visible", visibility(props));
  watch.dataset.vignetteMoqQuality = props.quality;
  const name = props.quality === "auto" ? undefined : props.quality;
  watch.backend?.video.source.target.update((current) => ({ ...current, name }));
}

/** The sound of a `<moq-watch>`, as a stream the target's mixer plays. */
export interface MoqAudioBridge {
  readonly stream: MediaStream;
  dispose(): void;
}

/**
 * Taps `<moq-watch>`'s decoded audio into a `MediaStream`. The element decodes into its own
 * `AudioContext`, and nodes cannot connect across contexts, so its output node feeds a stream
 * destination in that context, whose track joins `stream`. The decoder's node changes with the
 * rendition, and arrives only once audio does; each change swaps the track and announces it with
 * `addtrack`, which the mixer listens for.
 */
export function bridgeMoqAudio(watch: MoqWatchElement): MoqAudioBridge {
  const stream = new MediaStream();
  let tapped: AudioNode | undefined = undefined;
  let destination: MediaStreamAudioDestinationNode | undefined = undefined;
  const tap = (root: AudioNode | undefined) => {
    if (root === tapped) return;
    if (tapped !== undefined && destination !== undefined) tapped.disconnect(destination);
    for (const track of stream.getAudioTracks()) {
      stream.removeTrack(track);
      stream.dispatchEvent(new MediaStreamTrackEvent("removetrack", { track }));
    }
    tapped = root;
    // Only a realtime context can feed a stream; the decoder's always is one.
    if (root === undefined || !(root.context instanceof AudioContext)) return;
    destination = root.context.createMediaStreamDestination();
    root.connect(destination);
    for (const track of destination.stream.getAudioTracks()) {
      stream.addTrack(track);
      stream.dispatchEvent(new MediaStreamTrackEvent("addtrack", { track }));
    }
  };
  const root = watch.backend?.audio.out.root;
  tap(root?.peek());
  const stop = root?.subscribe(tap);
  return {
    stream,
    dispose() {
      stop?.();
      tap(undefined);
    },
  };
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
