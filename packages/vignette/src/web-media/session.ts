import { AudioChannelSchema, DEFAULT_MIX, type AudioChannel, type Mix } from "../core/audio.js";
import type { Source } from "../core/snapshot.js";
import type { TargetAudio } from "../target/status.js";
import { createDelayLine, type DelayLine, type PictureInput } from "./delay-line.js";
import {
  createMixer,
  UNSUPPORTED_WEB_FILTERS,
  type AudioInput,
  type MixerChannel,
} from "./mixer.js";

/**
 * What a source's plugin gives a browser target for its sound and picture: the element or stream
 * it plays (`audio`), and what it shows (`video`), which a negative sync offset delays.
 */
export interface SourceMedia {
  readonly audio?: AudioInput;
  readonly video?: PictureInput;
}

/** One revision, as a browser target's media session needs it. */
export interface MediaFrame {
  readonly sources: readonly Source[];
  readonly mix?: Mix;
  /** Sources a shown scene places with a visible item, or among its pictureless sources. */
  readonly audible: ReadonlySet<string>;
  /** What each source's plugin plays and shows, by source ID. */
  readonly media: ReadonlyMap<string, SourceMedia>;
}

/**
 * The sound and delayed pictures of one browser target: its mixer, a delay line per shown source
 * whose audio leads its picture, and the audio status the target reports.
 */
export interface MediaSession {
  readonly status: TargetAudio;
  /** The program mix, for recording or publishing. */
  readonly output: MediaStream | undefined;
  /** Converges sound and delay lines to one revision. */
  update(frame: MediaFrame): void;
  /** The delay line showing a source's picture, while its offset is negative and it is shown. */
  delayLine(sourceId: string): DelayLine | undefined;
  /** Empties the delay lines of `sourceId`, or of every source, after a restart. */
  reset(sourceId?: string): void;
  resume(): Promise<void>;
  /** Calls `listener` whenever `status` or a delay line changes. */
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/** Creates the media session of one browser target in `document`. */
export function createMediaSession(document: Document): MediaSession {
  const mixer = createMixer(document);
  const lines = new Map<string, DelayLine>();
  const listeners = new Set<() => void>();
  let unsupported: TargetAudio["unsupported"] = {};
  let status = statusOf(mixer.state, unsupported);
  let lastKey = JSON.stringify(status);

  /** Replaces `status` when it changed, and tells listeners when it or a delay line did. */
  function notify(linesChanged: boolean): void {
    const next = statusOf(mixer.state, unsupported);
    const key = JSON.stringify(next);
    if (key === lastKey && !linesChanged) return;
    if (key !== lastKey) {
      lastKey = key;
      status = next;
    }
    for (const listener of [...listeners]) listener();
  }
  const unsubscribe = mixer.subscribe(() => {
    notify(false);
  });

  /** Keeps one delay line per shown source whose audio must lead its picture. */
  function updateLines(frame: MediaFrame): boolean {
    let changed = false;
    const wanted = wantedLines(frame);
    for (const [id, line] of lines) {
      if (wanted.get(id)?.picture === line.picture) continue;
      line.dispose();
      lines.delete(id);
      changed = true;
    }
    for (const [id, { picture, delay }] of wanted) {
      const line = lines.get(id);
      if (line === undefined) {
        lines.set(id, createDelayLine(picture, delay));
        changed = true;
      } else line.setDelay(delay);
    }
    return changed;
  }

  return {
    get status() {
      return status;
    },
    get output() {
      return mixer.output;
    },
    update(frame) {
      // Mix every source with a channel and something to play, then converge the delay lines
      // and recompute what this browser cannot apply.
      const channels = new Map<string, MixerChannel>();
      for (const source of frame.sources) {
        const input = frame.media.get(source.id)?.audio;
        if (source.audio === undefined || input === undefined) continue;
        channels.set(source.id, {
          input,
          channel: source.audio,
          audible: frame.audible.has(source.id),
        });
      }
      const mix = frame.mix ?? DEFAULT_MIX;
      mixer.apply(channels, mix);
      const linesChanged = updateLines(frame);
      unsupported = webUnsupported(frame, lines);
      notify(linesChanged);
    },
    delayLine: (sourceId) => lines.get(sourceId),
    reset(sourceId) {
      for (const [id, line] of lines) if (sourceId === undefined || id === sourceId) line.reset();
    },
    resume: () => mixer.resume(),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      unsubscribe();
      for (const line of lines.values()) line.dispose();
      lines.clear();
      mixer.dispose();
    },
  };
}

/** The delay lines a revision wants: one per shown source with a picture and a negative offset. */
function wantedLines(frame: MediaFrame): Map<string, WantedLine> {
  const wanted = new Map<string, WantedLine>();
  for (const source of frame.sources) {
    // Skip a source whose audio does not lead, that shows nothing, or that no scene shows.
    const offset = source.audio?.syncOffsetMs ?? 0;
    const picture = frame.media.get(source.id)?.video;
    if (offset >= 0 || picture === undefined || !frame.audible.has(source.id)) continue;
    wanted.set(source.id, { picture, delay: -offset });
  }
  return wanted;
}

/** A delay line a revision wants: what it delays, and by how many ms. */
interface WantedLine {
  readonly picture: PictureInput;
  readonly delay: number;
}

/** Web Audio has a master bus with a limiter, so nothing of the mix is unsupported. */
function statusOf(
  state: TargetAudio["state"],
  unsupported: TargetAudio["unsupported"],
): TargetAudio {
  return { state, unsupported, mix: [] };
}

/** A channel nobody set: what a source plays with when the mixer cannot reach it. */
const DEFAULT_CHANNEL: AudioChannel = AudioChannelSchema.parse({});

/**
 * What of each channel a browser cannot apply: every field set away from its default for a source
 * whose plugin plays no sound into the mixer (a page in an iframe plays as it is), filters Web
 * Audio has no node for, monitoring (a page has one output), and a negative sync offset where
 * frames cannot be held.
 */
function webUnsupported(
  frame: MediaFrame,
  lines: ReadonlyMap<string, DelayLine>,
): TargetAudio["unsupported"] {
  const result: Record<string, readonly string[]> = {};
  for (const source of frame.sources) {
    // A source without a channel has nothing to apply; one without sound in the mixer has
    // nothing it can apply; otherwise list the fields and filters that are out of reach.
    const channel = source.audio;
    if (channel === undefined) continue;
    const media = frame.media.get(source.id);
    if (media?.audio === undefined) {
      const set = changedFields(channel);
      if (set.length > 0) result[source.id] = set;
      continue;
    }
    const fields = channel.filters
      .filter((filter) => UNSUPPORTED_WEB_FILTERS.has(filter.kind))
      .map((filter) => filter.id);
    if (channel.monitor !== "off") fields.push("monitor");
    if (lines.get(source.id)?.supported === false) fields.push("syncOffsetMs");
    if (fields.length > 0) result[source.id] = fields;
  }
  return result;
}

/** The fields of `channel` that differ from a channel nobody set. */
function changedFields(channel: AudioChannel): string[] {
  const fields = Object.keys(DEFAULT_CHANNEL).filter(
    (key) => key !== "filters" && key !== "tracks",
  );
  // SAFETY: Every key comes from an AudioChannel, so it names a field of `channel` too.
  const changed = fields.filter(
    (key) => channel[key as keyof AudioChannel] !== DEFAULT_CHANNEL[key as keyof AudioChannel],
  );
  return [...changed, ...channel.filters.map((filter) => filter.id)];
}
