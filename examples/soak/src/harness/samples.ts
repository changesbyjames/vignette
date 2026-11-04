import type { EventDetail, ServerSample } from "../server/probe.js";

export type { EventDetail };

/** One `-progress` block from ffmpeg: `frame`, `fps`, `bitrate`, `total_size`, `speed`, … */
export type Progress = Readonly<Record<string, string>>;

/** Totals for one group of processes, e.g. OBS's browser pages. `cpu` is percent of one core. */
export interface GroupSample {
  readonly count: number;
  readonly workingSet: number;
  readonly private: number;
  readonly handles: number;
  readonly threads: number;
  readonly cpu?: number;
}

/** The process groups the system probe sums. */
export type GroupName =
  | "obs"
  | "obs-browser"
  | "server"
  | "moq-relays"
  | "publishers"
  | "mediamtx"
  | "twitch-relay"
  | "analyzer"
  | "harness";

export interface SystemSample {
  readonly freeBytes: number;
  readonly totalBytes: number;
  readonly groups: Readonly<Record<GroupName, GroupSample>>;
}

/** OBS's `GetStreamStatus`, plus the bitrate since the previous sample. */
export interface StreamSample {
  readonly outputActive: boolean;
  readonly outputReconnecting: boolean;
  readonly outputCongestion: number;
  readonly outputBytes: number;
  readonly outputSkippedFrames: number;
  readonly outputTotalFrames: number;
  readonly kbps?: number;
}

/** OBS's `GetStats`, the stream, the program scene, and inputs created and removed since. */
export interface ObsSample {
  readonly cpuUsage: number;
  readonly memoryUsage: number;
  readonly activeFps: number;
  readonly averageFrameRenderTime: number;
  readonly renderSkippedFrames: number;
  readonly renderTotalFrames: number;
  readonly outputSkippedFrames: number;
  readonly outputTotalFrames: number;
  readonly stream: StreamSample;
  readonly program: string;
  readonly inputsCreated: number;
  readonly inputsRemoved: number;
}

/** The program path in MediaMTX, and its bitrate in and out since the previous sample. */
export interface MediaMtxSample {
  readonly ready?: boolean;
  readonly bytesReceived?: number;
  readonly bytesSent?: number;
  readonly readers?: number;
  readonly ingestKbps?: number;
  readonly egressKbps?: number;
}

export interface SceneSwitchSample {
  readonly scene: string;
  /** From the composer committing the scene to OBS putting it on program. */
  readonly latencyMs?: number;
}

/** What each probe writes to `samples.jsonl`. */
export interface SampleData {
  readonly obs: ObsSample;
  readonly server: ServerSample;
  readonly system: SystemSample;
  readonly mediamtx: MediaMtxSample;
  readonly "scene-switch": SceneSwitchSample;
  /** Each feed's OBS media state, e.g. `OBS_MEDIA_STATE_PLAYING`. */
  readonly feeds: Readonly<Record<string, string>>;
  /** Per feed, whether its thumbnail was identical to the previous minute's. */
  readonly frozen: Readonly<Record<string, boolean>>;
  readonly "twitch-relay": Progress;
  readonly analyzer: Progress;
}

export type Probe = keyof SampleData;

/** One line of `samples.jsonl` from probe `P`. */
export interface SampleOf<P extends Probe> {
  readonly t: number;
  readonly probe: P;
  readonly data: SampleData[P];
}

type EachProbe<P> = P extends Probe ? SampleOf<P> : never;

/** One line of `samples.jsonl`, from any probe. */
export type SampleLine = EachProbe<Probe>;

/** One line of `events.jsonl`. */
export interface EventLine {
  readonly t: number;
  readonly source: string;
  readonly event: string;
  readonly detail?: EventDetail;
}

/** What `status.json` holds: the run's latest headline numbers. */
export interface RunStatus {
  readonly startedAt?: string;
  readonly updatedAt?: string;
  readonly dir?: string;
  readonly twitch?: string;
  readonly hoursIn?: number;
  readonly obsMemoryMb?: number;
  readonly browserMemoryMb?: number;
  readonly browserPages?: number;
  readonly serverMemoryMb?: number;
  readonly relays?: number;
  readonly programReady?: boolean;
  readonly twitchBitrate?: string;
  readonly restarts?: Readonly<Record<string, number>>;
}
