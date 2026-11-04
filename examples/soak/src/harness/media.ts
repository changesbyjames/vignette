import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { LOCAL_FEEDS, type Feed } from "../feeds.js";
import type { Run } from "./log.js";
import type { Progress } from "./samples.js";
import { supervise, type Supervised } from "./supervise.js";

export interface Tools {
  readonly ffmpeg: string;
  readonly moq: string;
  readonly mediamtx: string;
}

/** Where OBS streams the program, and what the Twitch relay and the analyzer read. */
export const PROGRAM_PATH = "soak";
export const PROGRAM_URL = `rtmp://127.0.0.1:1935/${PROGRAM_PATH}`;
const API = "http://127.0.0.1:9997/v3";

const COLOURS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7"];

/**
 * One local feed: ffmpeg draws a moving test pattern stamped with the feed's name, wall-clock time
 * and frame number, encodes 360p30 H.264 with a keyframe a second, and pipes MPEG-TS into a `moq`
 * server that publishes it on the feed's port. The pair is supervised as one: `moq` is the child,
 * and ffmpeg lives and dies with it.
 */
export function publisher(run: Run, tools: Tools, feed: Feed, index: number): Supervised {
  const encoderLog = run.log(`publisher-${feed.id}-ffmpeg`);
  return supervise(run, `publisher-${feed.id}`, {
    start() {
      const label = `${feed.id.toUpperCase()}  %{localtime}  f%{n}`;
      const video = [
        "testsrc2=size=640x360:rate=30",
        `drawbox=x=0:y=0:w=iw:h=44:color=${COLOURS[index % COLOURS.length] ?? "#ffffff"}@1:t=fill`,
        `drawtext=fontfile='C\\:/Windows/Fonts/arialbd.ttf':text='${label}':x=12:y=8:fontsize=28:fontcolor=white`,
      ].join(",");
      const encoder = spawn(
        tools.ffmpeg,
        [
          ["-hide_banner", "-loglevel", "warning", "-re", "-f", "lavfi", "-i", video],
          ["-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-threads", "2"],
          ["-g", "30", "-keyint_min", "30", "-sc_threshold", "0", "-pix_fmt", "yuv420p"],
          ["-b:v", "800k", "-maxrate", "800k", "-bufsize", "800k", "-an", "-f", "mpegts", "-"],
        ].flat(),
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      );
      const server = spawn(
        tools.moq,
        [
          ["--log-level", "warn", "--listen", `127.0.0.1:${String(feed.port)}`],
          ["--listen-tls-generate", "localhost", "--auth-public", "**"],
          ["--broadcast", feed.broadcast, "import", "ts"],
        ].flat(),
        {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          env: { ...process.env, NO_COLOR: "1" },
        },
      );
      encoder.stdout.pipe(server.stdin);
      // A broken pipe is how either side learns the other died.
      server.stdin.on("error", () => undefined);
      encoder.stderr.on("data", (chunk: Buffer) => {
        encoderLog(chunk.toString());
      });
      encoder.once("exit", () => server.kill());
      server.once("exit", () => encoder.kill());
      return server;
    },
  });
}

export function publishers(run: Run, tools: Tools): Supervised[] {
  return LOCAL_FEEDS.map((feed, index) => publisher(run, tools, feed, index));
}

/**
 * MediaMTX on loopback only: OBS publishes RTMP to `PROGRAM_URL`, which it records as 10-minute
 * fMP4 segments under `recordings/`, and the API and Prometheus metrics report each leg's bytes.
 */
export function mediamtx(run: Run, tools: Tools): Supervised {
  const config = join(run.dir, "mediamtx.yml");
  const recordings = join(run.dir, "recordings").replaceAll("\\", "/");
  writeFileSync(
    config,
    `logLevel: info
logDestinations: [stdout]
authInternalUsers:
  - user: any
    pass:
    ips: ["127.0.0.1", "::1"]
    permissions:
      - action: publish
      - action: read
      - action: api
      - action: metrics
api: true
apiAddress: 127.0.0.1:9997
metrics: true
metricsAddress: 127.0.0.1:9998
rtmp: true
rtmpAddress: 127.0.0.1:1935
rtsp: false
hls: false
webrtc: false
srt: false
moq: false
playback: false
pathDefaults:
  record: false
paths:
  ${PROGRAM_PATH}:
    record: true
    recordPath: ${recordings}/%path/%Y-%m-%d_%H-%M-%S-%f
    recordFormat: fmp4
    recordSegmentDuration: 10m
    recordDeleteAfter: 0s
`,
  );
  return supervise(run, "mediamtx", {
    start: () =>
      spawn(tools.mediamtx, [config], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }),
  });
}

/** The program path as MediaMTX's API reports it. */
const ProgramPathSchema = z.object({
  ready: z.boolean(),
  bytesReceived: z.number(),
  bytesSent: z.number(),
  readers: z.array(z.unknown()).transform((readers) => readers.length),
});
export type ProgramPath = z.output<typeof ProgramPathSchema>;

/** The program path, or `undefined` while MediaMTX is down or nothing has published it yet. */
export async function programPath(): Promise<ProgramPath | undefined> {
  try {
    const response = await fetch(`${API}/paths/get/${PROGRAM_PATH}`);
    if (!response.ok) return undefined;
    return ProgramPathSchema.parse(await response.json());
  } catch {
    return undefined;
  }
}

/** Resolves once OBS is publishing the program to MediaMTX. */
async function programReady(): Promise<void> {
  for (;;) {
    const path = await programPath();
    if (path?.ready === true) return;
    await sleep(2_000);
  }
}

/** Calls `onBlock` with each complete `-progress` block written to `child`'s stdout. */
function readProgress(child: ChildProcess, onBlock: (progress: Progress) => void): void {
  let buffer = "";
  let block: Record<string, string> = {};
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    // `key=value` lines; `progress=continue` (or `end`) closes each block.
    buffer += chunk;
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const at = line.indexOf("=");
      if (at < 0) continue;
      const key = line.slice(0, at);
      block[key] = line.slice(at + 1).trim();
      if (key !== "progress") continue;
      onBlock(block);
      block = {};
    }
  });
}

/**
 * Copies the program from MediaMTX to Twitch without re-encoding, once `destination()` names
 * where (the stream key is there) and OBS publishes the program. `-progress` reports what reached
 * Twitch every 5 s.
 */
export function twitchRelay(
  run: Run,
  tools: Tools,
  destination: () => string | undefined,
  onProgress: (progress: Progress) => void,
): Supervised {
  let target: string | undefined = undefined;
  return supervise(run, "twitch-relay", {
    async ready() {
      while ((target = destination()) === undefined) await sleep(10_000);
      await programReady();
    },
    start() {
      const child = spawn(
        tools.ffmpeg,
        [
          ["-hide_banner", "-nostats", "-loglevel", "warning"],
          ["-progress", "pipe:1", "-stats_period", "5", "-rw_timeout", "10000000"],
          ["-i", PROGRAM_URL, "-c", "copy", "-f", "flv", "-flvflags", "no_duration_filesize"],
          [target ?? ""],
        ].flat(),
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      );
      readProgress(child, onProgress);
      return child;
    },
  });
}

/** What the analyzer saw in one `-progress` period, plus the detector events since. */
export interface AnalyzerEvent {
  readonly kind: "freeze-start" | "freeze-end" | "black-start" | "black-end";
  /** Seconds into the analyzer's input. */
  readonly at: number;
  readonly duration?: number;
}

/**
 * Decodes the program as Twitch receives it and watches it: `freezedetect` for a picture that
 * stops changing for 2 s, `blackdetect` for 1 s of black, and `-progress` for the decoded frame
 * rate, which drops below 60 when frames go missing.
 */
export function analyzer(
  run: Run,
  tools: Tools,
  onProgress: (progress: Progress) => void,
  onEvent: (event: AnalyzerEvent) => void,
): Supervised {
  return supervise(run, "analyzer", {
    ready: programReady,
    start() {
      const child = spawn(
        tools.ffmpeg,
        [
          ["-hide_banner", "-nostats", "-loglevel", "info"],
          ["-progress", "pipe:1", "-stats_period", "5", "-rw_timeout", "10000000"],
          ["-threads", "4", "-i", PROGRAM_URL, "-map", "0:v:0"],
          ["-vf", "scale=480:-2,freezedetect=n=0.001:d=2,blackdetect=d=1:pix_th=0.05"],
          ["-f", "null", "-"],
        ].flat(),
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      );
      readProgress(child, onProgress);
      let buffer = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/u);
        buffer = lines.pop() ?? "";
        for (const line of lines) for (const event of detections(line)) onEvent(event);
      });
      return child;
    },
  });
}

/** Detector events in one line of ffmpeg's log. */
function detections(line: string): AnalyzerEvent[] {
  const freeze = /lavfi\.freezedetect\.freeze_(start|end): ([\d.]+)/u.exec(line);
  if (freeze) {
    return [{ kind: freeze[1] === "start" ? "freeze-start" : "freeze-end", at: Number(freeze[2]) }];
  }
  const black = /black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/u.exec(line);
  if (black) {
    return [
      { kind: "black-start", at: Number(black[1]) },
      { kind: "black-end", at: Number(black[2]), duration: Number(black[3]) },
    ];
  }
  return [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
