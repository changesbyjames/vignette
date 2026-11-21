import { z } from "zod";

import { StableIdSchema } from "./ids.js";

/** The quietest volume a channel takes; OBS treats it as silence. */
export const MIN_VOLUME_DB = -100;
/** The loudest volume a channel takes, OBS's ceiling. */
export const MAX_VOLUME_DB = 26;
/** How early a channel's audio may be, in ms: the picture is delayed by that much instead. */
export const MIN_SYNC_OFFSET_MS = -950;
/** How late a channel's audio may be, in ms. */
export const MAX_SYNC_OFFSET_MS = 20_000;

/** A volume in decibels a channel or the mix can take. */
const VolumeDbSchema = z.number().min(MIN_VOLUME_DB).max(MAX_VOLUME_DB);
/** A volume in decibels a channel or the mix can take. */
export type VolumeDb = z.output<typeof VolumeDbSchema>;
/** A filter threshold, from silence to full scale. */
const ThresholdDbSchema = z.number().min(-60).max(0);
/** A filter threshold, from silence to full scale. */
export type ThresholdDb = z.output<typeof ThresholdDbSchema>;
/** A filter's attack, hold or release time. */
const TimeMsSchema = z.number().min(1).max(1000);
/** A filter's attack, hold or release time. */
export type TimeMs = z.output<typeof TimeMsSchema>;

/** Amplifies or attenuates the signal. */
const GainFilterSchema = z
  .object({
    kind: z.literal("gain"),
    id: StableIdSchema,
    db: z.number().min(-30).max(30).default(0),
  })
  .strict()
  .readonly();
/** One `GainFilter` filter. */
export type GainFilter = z.output<typeof GainFilterSchema>;

/** Reduces the dynamic range above a threshold. */
const CompressorFilterSchema = z
  .object({
    kind: z.literal("compressor"),
    id: StableIdSchema,
    thresholdDb: ThresholdDbSchema.default(-18),
    ratio: z.number().min(1).max(32).default(10),
    attackMs: TimeMsSchema.default(6),
    releaseMs: TimeMsSchema.default(60),
    outputDb: z.number().min(-32).max(32).default(0),
  })
  .strict()
  .readonly();
/** One `CompressorFilter` filter. */
export type CompressorFilter = z.output<typeof CompressorFilterSchema>;

/** Keeps the signal from exceeding a threshold. */
const LimiterFilterSchema = z
  .object({
    kind: z.literal("limiter"),
    id: StableIdSchema,
    thresholdDb: ThresholdDbSchema.default(-6),
    releaseMs: TimeMsSchema.default(60),
  })
  .strict()
  .readonly();
/** One `LimiterFilter` filter. */
export type LimiterFilter = z.output<typeof LimiterFilterSchema>;

/** Silences the signal while it is below a threshold. */
const NoiseGateFilterSchema = z
  .object({
    kind: z.literal("noise-gate"),
    id: StableIdSchema,
    openDb: ThresholdDbSchema.default(-26),
    closeDb: ThresholdDbSchema.default(-32),
    attackMs: TimeMsSchema.default(25),
    holdMs: TimeMsSchema.default(200),
    releaseMs: TimeMsSchema.default(150),
  })
  .strict()
  .readonly();
/** One `NoiseGateFilter` filter. */
export type NoiseGateFilter = z.output<typeof NoiseGateFilterSchema>;

/** Removes background noise. */
const NoiseSuppressionFilterSchema = z
  .object({
    kind: z.literal("noise-suppression"),
    id: StableIdSchema,
    levelDb: ThresholdDbSchema.default(-30),
  })
  .strict()
  .readonly();
/** One `NoiseSuppressionFilter` filter. */
export type NoiseSuppressionFilter = z.output<typeof NoiseSuppressionFilterSchema>;

/** A three-band equaliser. */
const EqFilterSchema = z
  .object({
    kind: z.literal("eq"),
    id: StableIdSchema,
    lowDb: z.number().min(-20).max(20).default(0),
    midDb: z.number().min(-20).max(20).default(0),
    highDb: z.number().min(-20).max(20).default(0),
  })
  .strict()
  .readonly();
/** One `EqFilter` filter. */
export type EqFilter = z.output<typeof EqFilterSchema>;

/** One audio filter of a channel, from the closed set every target maps. */
export const AudioFilterSchema = z.discriminatedUnion("kind", [
  GainFilterSchema,
  CompressorFilterSchema,
  LimiterFilterSchema,
  NoiseGateFilterSchema,
  NoiseSuppressionFilterSchema,
  EqFilterSchema,
]);
/** One audio filter of a channel. */
export type AudioFilter = z.output<typeof AudioFilterSchema>;
/** One audio filter as an author writes it, with defaults left out. */
export type AudioFilterInput = z.input<typeof AudioFilterSchema>;
/** The kind of an audio filter. */
export type AudioFilterKind = AudioFilter["kind"];

/** Where a channel is heard: the program output, the operator's monitor, or both. */
export const AudioMonitorSchema = z.enum(["off", "monitor-only", "monitor-and-output"]);
/** Where a channel is heard besides the program output. */
export type AudioMonitor = z.output<typeof AudioMonitorSchema>;

/**
 * The audio of one source: target-neutral desired state, applied by every target that renders the
 * source. A positive `syncOffsetMs` delays the audio; a negative one delays the picture, because
 * no target can play audio early. `tracks` are OBS's output tracks.
 */
export const AudioChannelSchema = z
  .object({
    volumeDb: VolumeDbSchema.default(0),
    muted: z.boolean().default(false),
    balance: z.number().min(-1).max(1).default(0),
    mono: z.boolean().default(false),
    syncOffsetMs: z.number().int().min(MIN_SYNC_OFFSET_MS).max(MAX_SYNC_OFFSET_MS).default(0),
    monitor: AudioMonitorSchema.default("off"),
    tracks: z.array(z.number().int().min(1).max(6)).readonly().default([1, 2, 3, 4, 5, 6]),
    filters: z.array(AudioFilterSchema).readonly().default([]),
  })
  .strict()
  .superRefine((channel, context) => {
    const seen = new Set<string>();
    for (const [index, filter] of channel.filters.entries()) {
      if (seen.has(filter.id)) {
        context.addIssue({
          code: "custom",
          path: ["filters", index, "id"],
          message: `Filter ID '${filter.id}' is used twice in one channel.`,
        });
      }
      seen.add(filter.id);
    }
  })
  .readonly();
/** The audio of one source. */
export type AudioChannel = z.output<typeof AudioChannelSchema>;
/** A source's `audio` prop: its channel with defaults left out. */
export type AudioChannelInput = z.input<typeof AudioChannelSchema>;

/** The show's master bus: a volume added to every channel and an optional limiter. */
export const MixSchema = z
  .object({
    volumeDb: VolumeDbSchema.default(0),
    limiter: z
      .object({ thresholdDb: ThresholdDbSchema.default(-1), releaseMs: TimeMsSchema.default(60) })
      .strict()
      .readonly()
      .optional(),
  })
  .strict()
  .readonly();
/** The show's master bus. */
export type Mix = z.output<typeof MixSchema>;
/** `<Show mix>`: the master bus with defaults left out. */
export type MixInput = z.input<typeof MixSchema>;

/** The master bus of a show that sets none. */
export const DEFAULT_MIX: Mix = { volumeDb: 0 };

/** A channel's volume with the master's added, within the range every target takes. */
export function channelVolumeDb(channel: AudioChannel, mix: Mix): number {
  return Math.min(MAX_VOLUME_DB, Math.max(MIN_VOLUME_DB, channel.volumeDb + mix.volumeDb));
}

/** A volume in decibels as a linear gain; the floor is silence. */
export function dbToGain(db: number): number {
  return db <= MIN_VOLUME_DB ? 0 : 10 ** (db / 20);
}
