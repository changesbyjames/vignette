import {
  channelVolumeDb,
  DEFAULT_MIX,
  type AudioChannel,
  type AudioFilter,
  type AudioMonitor,
  type Mix,
} from "../core/audio.js";
import type { Snapshot } from "../core/snapshot.js";
import type { TargetAudio } from "../target/status.js";
import type { ObsJsonObject } from "./operations.js";

/** OBS's output tracks; a channel's `tracks` turn on some of them and off the rest. */
const OBS_TRACKS = [1, 2, 3, 4, 5, 6] as const;

/** An input's audio as OBS reports and takes it. `balance` runs from 0 (left) to 1 (right). */
export interface ObsAudioState {
  readonly muted: boolean;
  readonly volumeDb: number;
  readonly balance: number;
  readonly syncOffsetMs: number;
  readonly monitorType: string;
  readonly tracks: ObsJsonObject;
}

/** A new input's audio, before the target changes any of it. */
export const OBS_DEFAULT_AUDIO: ObsAudioState = {
  muted: false,
  volumeDb: 0,
  balance: 0.5,
  syncOffsetMs: 0,
  monitorType: "OBS_MONITORING_TYPE_NONE",
  tracks: obsTracks(OBS_TRACKS),
};

/** The parts of an input's audio the target converges; absent ones are left as they are. */
export type DesiredObsAudio = Partial<ObsAudioState>;

/**
 * What an input should sound like for a source's channel and the show's mix. A source without a
 * channel (`audio={false}`) has an input that is only muted.
 */
export function desiredObsAudio(channel: AudioChannel | undefined, mix: Mix): DesiredObsAudio {
  if (channel === undefined) return { muted: true };
  return {
    muted: channel.muted,
    volumeDb: channelVolumeDb(channel, mix),
    balance: (channel.balance + 1) / 2,
    syncOffsetMs: channel.syncOffsetMs,
    monitorType: OBS_MONITOR_TYPES[channel.monitor],
    tracks: obsTracks(channel.tracks),
  };
}

const OBS_MONITOR_TYPES = {
  off: "OBS_MONITORING_TYPE_NONE",
  "monitor-only": "OBS_MONITORING_TYPE_MONITOR_ONLY",
  "monitor-and-output": "OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT",
} as const satisfies Readonly<Record<AudioMonitor, string>>;

/** `SetInputAudioTracks`'s map: every OBS track, on when the channel names it. */
function obsTracks(tracks: readonly number[]): ObsJsonObject {
  const on = new Set(tracks);
  return Object.fromEntries(OBS_TRACKS.map((track) => [String(track), on.has(track)]));
}

/** A managed audio filter as OBS creates it. */
export interface ObsFilter {
  readonly filterKind: string;
  readonly filterSettings: ObsJsonObject;
}

/** The OBS filter of one of a channel's filters. */
export function obsFilter(filter: AudioFilter): ObsFilter {
  switch (filter.kind) {
    case "gain":
      return { filterKind: "gain_filter", filterSettings: { db: filter.db } };
    case "compressor":
      return {
        filterKind: "compressor_filter",
        filterSettings: {
          ratio: filter.ratio,
          threshold: filter.thresholdDb,
          attack_time: filter.attackMs,
          release_time: filter.releaseMs,
          output_gain: filter.outputDb,
        },
      };
    case "limiter":
      return {
        filterKind: "limiter_filter",
        filterSettings: { threshold: filter.thresholdDb, release_time: filter.releaseMs },
      };
    case "noise-gate":
      return {
        filterKind: "noise_gate_filter",
        filterSettings: {
          open_threshold: filter.openDb,
          close_threshold: filter.closeDb,
          attack_time: filter.attackMs,
          hold_time: filter.holdMs,
          release_time: filter.releaseMs,
        },
      };
    case "noise-suppression":
      return {
        filterKind: "noise_suppress_filter_v2",
        // OBS reads the level as a whole number of dB.
        filterSettings: { method: "speex", suppress_level: Math.round(filter.levelDb) },
      };
    case "eq":
      return {
        filterKind: "basic_eq_filter",
        filterSettings: { low: filter.lowDb, mid: filter.midDb, high: filter.highDb },
      };
    default:
      return unreachable(filter);
  }
}

function unreachable(value: never): never {
  throw new Error(`Unhandled audio filter ${JSON.stringify(value)}.`);
}

/**
 * What of a snapshot's audio OBS cannot apply: obs-websocket does not expose an input's mono
 * downmix, and OBS has no master bus to limit.
 */
export function obsAudioStatus(snapshot: Snapshot): TargetAudio {
  const unsupported: Record<string, readonly string[]> = {};
  for (const source of snapshot.sources) {
    if (source.audio?.mono === true) unsupported[source.id] = ["mono"];
  }
  const mix = snapshot.mix ?? DEFAULT_MIX;
  return { state: "running", unsupported, mix: mix.limiter === undefined ? [] : ["limiter"] };
}
