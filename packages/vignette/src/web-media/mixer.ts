import {
  dbToGain,
  MAX_SYNC_OFFSET_MS,
  type AudioChannel,
  type AudioFilter,
  type Mix,
} from "../core/audio.js";

/** Where a source's sound comes from: a media element it plays, or a stream of tracks. */
export type AudioInput = HTMLMediaElement | MediaStream;

/** One channel the mixer should play, as the target sees it after a revision. */
export interface MixerChannel {
  readonly input: AudioInput;
  readonly channel: AudioChannel;
  /** Whether a shown scene places the source; a channel that is not audible is silent. */
  readonly audible: boolean;
}

/** Whether the mixer plays: `blocked` until a user gesture lets the page play sound. */
export type MixerState = "running" | "blocked" | "unavailable";

/**
 * Plays every source's sound through one Web Audio graph: a strip per channel (delay, mono, the
 * filters, balance, volume) into a master bus (volume, optional limiter) that plays to the
 * speakers and to `output`, a `MediaStream` of the program mix. Without Web Audio it falls back to
 * each media element's own `muted` and `volume`, which is all a page without it can do.
 */
export interface Mixer {
  readonly state: MixerState;
  /** The program mix, for recording or publishing; undefined until Web Audio starts. */
  readonly output: MediaStream | undefined;
  /** Converges the graph to `channels` by source ID; channels it no longer lists are removed. */
  apply(channels: ReadonlyMap<string, MixerChannel>, mix: Mix): void;
  /** Starts sound after a user gesture, where autoplay policy waits for one. */
  resume(): Promise<void>;
  /** Calls `listener` when `state` changes. */
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/** Filter kinds Web Audio has no node for. */
export const UNSUPPORTED_WEB_FILTERS: ReadonlySet<AudioFilter["kind"]> = new Set([
  "noise-gate",
  "noise-suppression",
]);

/** Seconds a parameter takes to reach a new value, short enough to sound immediate. */
const RAMP_SECONDS = 0.015;

/** The longest delay a strip needs, with headroom over the channel's maximum. */
const MAX_DELAY_SECONDS = MAX_SYNC_OFFSET_MS / 1000 + 0.5;

/**
 * Creates the mixer of one page. The `AudioContext` is created only once a channel has an input,
 * so a page without sound never asks for one; it starts as soon as the page has had a user
 * gesture, which `document` is watched for.
 */
export function createMixer(document: Document): Mixer {
  const listeners = new Set<() => void>();
  const strips = new Map<string, Strip>();
  const fallbacks = new Map<string, HTMLMediaElement>();
  let graph: Graph | undefined = undefined;
  let state: MixerState = "unavailable";

  function setState(next: MixerState): void {
    if (next === state) return;
    state = next;
    for (const listener of [...listeners]) listener();
  }

  function ensureGraph(): Graph | undefined {
    if (graph !== undefined) return graph;
    const view = document.defaultView;
    if (view === null || !("AudioContext" in view)) return undefined;
    graph = createGraph(new view.AudioContext());
    const context = graph.context;
    const update = () => {
      setState(context.state === "running" ? "running" : "blocked");
      // Elements stay muted until the context runs, so autoplay policy lets their picture play.
      for (const strip of strips.values()) strip.unmute(context.state === "running");
    };
    context.addEventListener("statechange", update);
    update();
    watchGestures(document, context);
    return graph;
  }

  return {
    get state() {
      return state;
    },
    get output() {
      return graph?.output.stream;
    },
    apply(channels, mix) {
      // Start Web Audio once there is something to play, else fall back to the elements; then
      // drop strips whose source or input went, create missing ones, and apply every channel.
      const active = channels.size > 0 ? ensureGraph() : graph;
      if (active === undefined) {
        applyFallback(channels, mix, fallbacks);
        return;
      }
      active.applyMix(mix);
      for (const [id, strip] of strips) {
        if (channels.get(id)?.input === strip.input) continue;
        strip.dispose();
        strips.delete(id);
      }
      for (const [id, wanted] of channels) {
        let strip = strips.get(id);
        if (strip === undefined) {
          strip = createStrip(active, wanted.input, document);
          strips.set(id, strip);
        }
        strip.apply(wanted.channel, wanted.audible);
        strip.unmute(active.context.state === "running");
      }
    },
    async resume() {
      await graph?.context.resume();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      for (const strip of strips.values()) strip.dispose();
      strips.clear();
      void graph?.context.close().catch(() => undefined);
      graph = undefined;
      setState("unavailable");
    },
  };
}

/** Resumes `context` on the page's first pointer or key press, as autoplay policy requires. */
function watchGestures(document: Document, context: AudioContext): void {
  const resume = () => {
    if (context.state === "closed") return;
    void context.resume().catch(() => undefined);
    if (context.state === "running") stop();
  };
  const stop = () => {
    document.removeEventListener("pointerdown", resume, true);
    document.removeEventListener("keydown", resume, true);
  };
  document.addEventListener("pointerdown", resume, true);
  document.addEventListener("keydown", resume, true);
  context.addEventListener("statechange", () => {
    if (context.state === "running" || context.state === "closed") stop();
  });
}

/**
 * Without Web Audio, each element plays by itself: muted unless audible and unmuted, at the
 * channel's volume (an element cannot be louder than full scale). Streams cannot be controlled.
 */
function applyFallback(
  channels: ReadonlyMap<string, MixerChannel>,
  mix: Mix,
  previous: Map<string, HTMLMediaElement>,
): void {
  for (const [id, element] of previous) {
    if (channels.get(id)?.input === element) continue;
    element.muted = true;
    previous.delete(id);
  }
  for (const [id, { input, channel, audible }] of channels) {
    if (!(input instanceof HTMLMediaElement)) continue;
    previous.set(id, input);
    input.muted = !audible || channel.muted;
    input.volume = Math.min(1, dbToGain(channel.volumeDb + mix.volumeDb));
  }
}

/** The master bus: everything strips feed, played to the speakers and to `output`. */
interface Graph {
  readonly context: AudioContext;
  /** Where strips connect. */
  readonly input: GainNode;
  readonly output: MediaStreamAudioDestinationNode;
  applyMix(mix: Mix): void;
}

function createGraph(context: AudioContext): Graph {
  const input = context.createGain();
  const limiter = context.createDynamicsCompressor();
  const output = context.createMediaStreamDestination();
  let limited: boolean | undefined = undefined;
  return {
    context,
    input,
    output,
    applyMix(mix) {
      // Set the master volume and limiter, and rewire only when the limiter comes or goes.
      ramp(context, input.gain, dbToGain(mix.volumeDb));
      const limit = mix.limiter;
      if (limit !== undefined) {
        limiter.threshold.value = limit.thresholdDb;
        limiter.release.value = limit.releaseMs / 1000;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.001;
        limiter.knee.value = 0;
      }
      if (limited === (limit !== undefined)) return;
      limited = limit !== undefined;
      input.disconnect();
      limiter.disconnect();
      const last = limited ? limiter : input;
      if (limited) input.connect(limiter);
      last.connect(context.destination);
      last.connect(output);
    },
  };
}

/** One channel's chain of nodes, from its input to the master bus. */
interface Strip {
  readonly input: AudioInput;
  apply(channel: AudioChannel, audible: boolean): void;
  /** An element input plays unmuted only while the context runs. */
  unmute(running: boolean): void;
  dispose(): void;
}

/** `createMediaElementSource` works once per element, so its node outlives any one strip. */
const elementSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

function createStrip(graph: Graph, input: AudioInput, document: Document): Strip {
  const { context } = graph;
  const delay = context.createDelay(MAX_DELAY_SECONDS);
  const mono = context.createGain();
  mono.channelCountMode = "explicit";
  mono.channelInterpretation = "speakers";
  const panner = context.createStereoPanner();
  const gain = context.createGain();
  gain.gain.value = 0;
  panner.connect(gain);
  gain.connect(graph.input);
  const source = connectInput(context, input, delay, document);
  delay.connect(mono);
  let filters: FilterChain = createFilterChain(context, [], mono, panner);
  return {
    input,
    apply(channel, audible) {
      // A negative offset delays the picture instead, so the audio is never delayed below zero;
      // the filter chain is rebuilt only when its kinds or order change.
      ramp(context, delay.delayTime, Math.max(0, channel.syncOffsetMs) / 1000);
      mono.channelCount = channel.mono ? 1 : 2;
      ramp(context, panner.pan, channel.balance);
      const level = audible && !channel.muted ? dbToGain(channel.volumeDb) : 0;
      ramp(context, gain.gain, level);
      if (!filters.matches(channel.filters)) {
        filters.dispose();
        filters = createFilterChain(context, channel.filters, mono, panner);
      }
      filters.apply(channel.filters);
    },
    unmute(running) {
      if (input instanceof HTMLMediaElement) input.muted = !running;
    },
    dispose() {
      source.dispose();
      filters.dispose();
      for (const node of [delay, mono, panner, gain]) node.disconnect();
    },
  };
}

/** A strip's connection to its input. */
interface InputConnection {
  dispose(): void;
}

/**
 * Connects an element through its one source node, or a stream through a node per set of audio
 * tracks: rebuilt when tracks arrive or leave, so a stream whose audio comes late is heard, and
 * video tracks are ignored.
 */
function connectInput(
  context: AudioContext,
  input: AudioInput,
  into: AudioNode,
  document: Document,
): InputConnection {
  if (input instanceof HTMLMediaElement) {
    const node = elementSources.get(input) ?? context.createMediaElementSource(input);
    elementSources.set(input, node);
    node.connect(into);
    return {
      dispose() {
        node.disconnect();
        input.muted = true;
      },
    };
  }
  let node: MediaStreamAudioSourceNode | undefined = undefined;
  const preload = preloadStream(input, document);
  const connect = () => {
    node?.disconnect();
    node = undefined;
    if (input.getAudioTracks().length === 0) return;
    node = context.createMediaStreamSource(input);
    node.connect(into);
  };
  connect();
  input.addEventListener("addtrack", connect);
  input.addEventListener("removetrack", connect);
  return {
    dispose() {
      input.removeEventListener("addtrack", connect);
      input.removeEventListener("removetrack", connect);
      node?.disconnect();
      preload.remove();
    },
  };
}

/**
 * Chromium does not feed a WebRTC stream's audio to Web Audio until a media element plays it
 * (https://issues.chromium.org/issues/40094084), so a muted, detached `<audio>` plays it for as
 * long as the strip lives.
 */
function preloadStream(stream: MediaStream, document: Document): HTMLAudioElement {
  const audio = document.createElement("audio");
  audio.muted = true;
  audio.srcObject = stream;
  void audio.play().catch(() => undefined);
  return audio;
}

/** A strip's filters, between its mono node and its panner. */
interface FilterChain {
  /** Whether the chain has the same kinds of filter in the same order as `filters`. */
  matches(filters: readonly AudioFilter[]): boolean;
  apply(filters: readonly AudioFilter[]): void;
  dispose(): void;
}

/** One filter's nodes: audio enters `input` and leaves `output`. */
interface FilterNodes {
  readonly kind: AudioFilter["kind"];
  readonly input: AudioNode;
  readonly output: AudioNode;
  apply(filter: AudioFilter): void;
  readonly nodes: readonly AudioNode[];
}

function createFilterChain(
  context: AudioContext,
  filters: readonly AudioFilter[],
  from: AudioNode,
  to: AudioNode,
): FilterChain {
  const chain = filters.flatMap((filter) => {
    const nodes = filterNodes(context, filter);
    return nodes === undefined ? [] : [nodes];
  });
  from.disconnect();
  let previous = from;
  for (const nodes of chain) {
    previous.connect(nodes.input);
    previous = nodes.output;
  }
  previous.connect(to);
  const supported = (list: readonly AudioFilter[]) =>
    list.filter((filter) => !UNSUPPORTED_WEB_FILTERS.has(filter.kind));
  return {
    matches(next) {
      const kinds = supported(next).map((filter) => filter.kind);
      return (
        kinds.length === chain.length && kinds.every((kind, index) => chain[index]?.kind === kind)
      );
    },
    apply(next) {
      for (const [index, filter] of supported(next).entries()) chain[index]?.apply(filter);
    },
    dispose() {
      from.disconnect();
      for (const nodes of chain) for (const node of nodes.nodes) node.disconnect();
    },
  };
}

/** The nodes of one filter; undefined for a kind Web Audio cannot do. */
function filterNodes(context: AudioContext, filter: AudioFilter): FilterNodes | undefined {
  switch (filter.kind) {
    case "gain":
      return gainNodes(context);
    case "compressor":
    case "limiter":
      return compressorNodes(context, filter.kind);
    case "eq":
      return eqNodes(context);
    default:
      return undefined;
  }
}

function gainNodes(context: AudioContext): FilterNodes {
  const node = context.createGain();
  return {
    kind: "gain",
    input: node,
    output: node,
    nodes: [node],
    apply(filter) {
      if (filter.kind === "gain") ramp(context, node.gain, dbToGain(filter.db));
    },
  };
}

/**
 * A compressor, and its output gain; a limiter is a compressor at Web Audio's highest ratio with
 * the fastest attack, which approximates OBS's limiter.
 */
function compressorNodes(context: AudioContext, kind: "compressor" | "limiter"): FilterNodes {
  const compressor = context.createDynamicsCompressor();
  const makeup = context.createGain();
  compressor.knee.value = 0;
  compressor.connect(makeup);
  return {
    kind,
    input: compressor,
    output: makeup,
    nodes: [compressor, makeup],
    apply(filter) {
      if (filter.kind === "compressor") {
        compressor.threshold.value = filter.thresholdDb;
        compressor.ratio.value = Math.min(20, filter.ratio);
        compressor.attack.value = filter.attackMs / 1000;
        compressor.release.value = filter.releaseMs / 1000;
        ramp(context, makeup.gain, dbToGain(filter.outputDb));
      } else if (filter.kind === "limiter") {
        compressor.threshold.value = filter.thresholdDb;
        compressor.ratio.value = 20;
        compressor.attack.value = 0.001;
        compressor.release.value = filter.releaseMs / 1000;
      }
    },
  };
}

/** Three bands like OBS's: a low shelf, a peak in the middle and a high shelf. */
function eqNodes(context: AudioContext): FilterNodes {
  const low = context.createBiquadFilter();
  const mid = context.createBiquadFilter();
  const high = context.createBiquadFilter();
  low.type = "lowshelf";
  low.frequency.value = 250;
  mid.type = "peaking";
  mid.frequency.value = 1500;
  mid.Q.value = 0.7;
  high.type = "highshelf";
  high.frequency.value = 6000;
  low.connect(mid);
  mid.connect(high);
  return {
    kind: "eq",
    input: low,
    output: high,
    nodes: [low, mid, high],
    apply(filter) {
      if (filter.kind !== "eq") return;
      ramp(context, low.gain, filter.lowDb);
      ramp(context, mid.gain, filter.midDb);
      ramp(context, high.gain, filter.highDb);
    },
  };
}

/** Moves a parameter to `value` over a few milliseconds, so changes do not click. */
function ramp(context: BaseAudioContext, param: AudioParam, value: number): void {
  param.setTargetAtTime(value, context.currentTime, RAMP_SECONDS / 3);
}
