/**
 * The soak harness: runs the soak show into the isolated OBS for a day, streams the program to
 * Twitch through MediaMTX, and logs everything it can measure into a run directory.
 *
 * ```sh
 * node dist/harness/soak.js --hours 24 [--bandwidth-test] [--no-chaos]
 * ```
 *
 * Processes: six test-pattern publishers (ffmpeg | moq), MediaMTX, the isolated OBS, the show's
 * server (which drives OBS and reports its probe over IPC), the Twitch relay and the analyzer.
 * Each is supervised and restarted on exit. The Twitch relay starts once the stream key file
 * exists, so a run can start before the key is there. Create `STOP` in the run directory to end.
 */
import { fork, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import type { ProbeMessage } from "../server/probe.js";
import { openRun } from "./log.js";
import { analyzer, mediamtx, programPath, publishers, twitchRelay, type Tools } from "./media.js";
import { writeSoakProfile } from "./obs-profile.js";
import { obsMonitor, obsProcess } from "./obs.js";
import { writeReport } from "./report.js";
import type { GroupName, GroupSample, MediaMtxSample, Progress } from "./samples.js";
import { every, supervise, type Supervised } from "./supervise.js";
import { grouper, killProcesses, systemSnapshot, type ProcessInfo } from "./system.js";

const { values } = parseArgs({
  options: {
    hours: { type: "string", default: "24" },
    runs: { type: "string", default: "C:\\vignette-soak-runs" },
    tools: { type: "string", default: "C:\\vignette-tools" },
    "twitch-key-file": { type: "string", default: "C:\\vignette-tools\\twitch-key.txt" },
    "twitch-ingest": { type: "string", default: "rtmp://live.twitch.tv/app" },
    "bandwidth-test": { type: "boolean", default: false },
    "no-chaos": { type: "boolean", default: false },
    bitrate: { type: "string", default: "6000" },
  },
});

const hours = Number(values.hours);
const tools: Tools = {
  ffmpeg: join(values.tools, "ffmpeg", "bin", "ffmpeg.exe"),
  moq: join(values.tools, "moq", "moq.exe"),
  mediamtx: join(values.tools, "mediamtx", "mediamtx.exe"),
};
const obsExe = join(values.tools, "obs", "bin", "64bit", "obs64.exe");
const obsRoot = join(values.tools, "obs").toLowerCase();
const obsUrl = process.env.OBS_URL ?? "ws://127.0.0.1:4456";
const obsPassword = process.env.OBS_PASSWORD ?? "";
const bandwidthTest = values["bandwidth-test"];

const stamp = new Date()
  .toISOString()
  .replaceAll(":", "-")
  .replace(/\.\d+Z$/u, "Z");
const run = openRun(join(values.runs, stamp));
writeFileSync(join(values.runs, "current.txt"), run.dir);
run.redact(obsPassword);
run.event("harness", "run-started", { hours, dir: run.dir, chaos: !values["no-chaos"] });

/** The Twitch destination, once the key file exists; the key is redacted from every log. */
function twitchDestination(): string | undefined {
  const file = values["twitch-key-file"];
  const key = existsSync(file) ? readFileSync(file, "utf8").trim() : "";
  if (key === "") return undefined;
  run.redact(key);
  return `${values["twitch-ingest"]}/${key}${bandwidthTest ? "?bandwidthtest=true" : ""}`;
}

const isIsolatedObs = (info: ProcessInfo) =>
  info.Name === "obs64.exe" && (info.ExecutablePath ?? "").toLowerCase().startsWith(obsRoot);

// Relays and publishers a crashed earlier run left behind would hold the ports, and a fresh OBS
// gives the memory baseline (portable mode keeps its settings).
const before = await systemSnapshot();
const leftovers = before.processes.filter(
  (info) =>
    ["moq.exe", "ffmpeg.exe", "mediamtx.exe"].includes(info.Name) &&
    (info.ExecutablePath ?? "").toLowerCase().startsWith(values.tools.toLowerCase()),
);
const staleObs = before.processes.filter(isIsolatedObs);
if (leftovers.length + staleObs.length > 0) {
  run.event("harness", "killing-leftovers", {
    pids: [...leftovers, ...staleObs].map((info) => info.ProcessId).join(" "),
  });
  killProcesses([...leftovers, ...staleObs].map((info) => info.ProcessId));
  await delay(3_000);
}

// OBS reads its output settings only when it loads the profile, so they are written while it is down.
const profileDir = join(
  values.tools,
  "obs",
  "config",
  "obs-studio",
  "basic",
  "profiles",
  "vignettesoak",
);
run.event("harness", "profile-written", {
  written: writeSoakProfile(profileDir, Number(values.bitrate)),
  encoder: "h264_texture_amf speed CBR, keyframe every 2 s",
});

const feeds = publishers(run, tools);
const media = mediamtx(run, tools);
const obsOptions = {
  exe: obsExe,
  url: obsUrl,
  password: obsPassword,
  bitrate: Number(values.bitrate),
};
const obs = obsProcess(run, obsOptions);
// A hung OBS (its crash dialog, say) is killed, and its supervisor starts a new one.
const monitor = obsMonitor(run, obsOptions, () => {
  obs.kill();
});
await monitor.ready();

let firstSettle = true;
const server = supervise(run, "server", {
  start: startServer,
  terminate: (child: ChildProcess) => child.send("shutdown"),
});

function startServer(): ChildProcess {
  const child = fork(fileURLToPath(new URL("../server/entry.js", import.meta.url)), [], {
    env: {
      ...process.env,
      // React's development build measures every render; the soak measures the production one.
      NODE_ENV: "production",
      PORT: "3100",
      OBS_URL: obsUrl,
      OBS_PASSWORD: obsPassword,
      VIGNETTE_MOQ_CLI: tools.moq,
      // The local feeds' `moq` servers generate self-signed certificates.
      MOQ_CONNECT_TLS_INSECURE: "true",
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.on("message", onProbe);
  child.stderr?.on("data", (chunk: Buffer) => {
    // The MoQ plugin reports relay restarts on stderr.
    for (const line of chunk.toString().split(/\r?\n/u)) {
      if (line.startsWith("@strangecyan/vignette-moq:"))
        run.event("moq-relay", "restart", { line });
    }
  });
  return child;
}

/** Logs the server's samples and events, starts the stream at the first settle, times scenes. */
function onProbe(message: ProbeMessage): void {
  if (message.type === "sample") {
    run.sample("server", message.sample);
    if (!firstSettle || message.sample.phase !== "settled") return;
    // OBS streams to MediaMTX from the first settled revision on.
    firstSettle = false;
    run.event("harness", "first-settle");
    monitor.stream();
    return;
  }
  if (message.event === "scene-requested") {
    monitor.sceneRequested(String(message.detail?.scene));
    return;
  }
  run.event("server", message.event, message.detail);
}

let relayProgress: Progress = {};
const relay = twitchRelay(run, tools, twitchDestination, (progress) => {
  relayProgress = progress;
  run.sample("twitch-relay", progress);
});
const watcher = analyzer(
  run,
  tools,
  (progress) => {
    run.sample("analyzer", progress);
  },
  (event) => {
    run.event("analyzer", event.kind, { at: event.at, duration: event.duration });
  },
);
const supervised: Supervised[] = [obs, media, server, ...feeds, relay, watcher];

const groups = grouper();
const byPid = (child: ChildProcess | undefined) => (info: ProcessInfo) =>
  child?.pid !== undefined && info.ProcessId === child.pid;

/** Memory, handles and CPU of each process group, and MediaMTX's view of the program. */
async function sampleSystem(): Promise<void> {
  const snapshot = await systemSnapshot();
  const serverPid = server.child?.pid;
  const sample = groups(snapshot, {
    obs: isIsolatedObs,
    "obs-browser": (info) =>
      info.Name === "obs-browser-page.exe" &&
      (info.ExecutablePath ?? "").toLowerCase().startsWith(obsRoot),
    server: byPid(server.child),
    "moq-relays": (info) => info.Name === "moq.exe" && info.ParentProcessId === serverPid,
    publishers: (info) => info.ParentProcessId === process.pid && isPublisher(info),
    mediamtx: byPid(media.child),
    "twitch-relay": byPid(relay.child),
    analyzer: byPid(watcher.child),
    harness: (info) => info.ProcessId === process.pid,
  });
  run.sample("system", {
    freeBytes: snapshot.freeBytes,
    totalBytes: snapshot.totalBytes,
    groups: sample,
  });
  const path = await sampleMediaMtx();
  writeStatus(sample, path);
}

/** The publishers' processes: `moq … import` and ffmpeg drawing the test pattern. */
function isPublisher(info: ProcessInfo): boolean {
  const command = info.CommandLine ?? "";
  if (info.Name === "moq.exe") return command.includes(" import ");
  return info.Name === "ffmpeg.exe" && command.includes("lavfi");
}

let previousPath: PathBytes | undefined = undefined;

/** MediaMTX's program path, with bitrates from its byte counters' growth since the last call. */
async function sampleMediaMtx(): Promise<MediaMtxSample> {
  const path = await programPath();
  const at = Date.now();
  const rate = (now: number, then: number | undefined) =>
    previousPath === undefined || then === undefined || now < then
      ? undefined
      : ((now - then) * 8) / (at - previousPath.at);
  const sample: MediaMtxSample =
    path === undefined
      ? {}
      : {
          ...path,
          ingestKbps: rate(path.bytesReceived, previousPath?.received),
          egressKbps: rate(path.bytesSent, previousPath?.sent),
        };
  run.sample("mediamtx", sample);
  previousPath = path && { at, received: path.bytesReceived, sent: path.bytesSent };
  return sample;
}

interface PathBytes {
  readonly at: number;
  readonly received: number;
  readonly sent: number;
}

function writeStatus(sample: Record<GroupName, GroupSample>, path: MediaMtxSample): void {
  const megabytes = (bytes: number) => Math.round(bytes / 1e6);
  run.status({
    hoursIn: Number(((Date.now() - run.startedAt) / 3_600_000).toFixed(2)),
    twitch: relay.child === undefined ? "not streaming" : bandwidthTest ? "bandwidth test" : "live",
    obsMemoryMb: megabytes(sample.obs.private),
    browserMemoryMb: megabytes(sample["obs-browser"].private),
    browserPages: sample["obs-browser"].count,
    serverMemoryMb: megabytes(sample.server.workingSet),
    relays: sample["moq-relays"].count,
    programReady: path.ready,
    twitchBitrate: relayProgress.bitrate,
    restarts: Object.fromEntries(supervised.map((child) => [child.name, child.restarts])),
  });
}

/**
 * Faults injected on a schedule, alternating: a publisher goes away for 20 s (its MoQ relay and
 * the OBS media source must recover by themselves), or one of the server's MoQ relays is killed
 * (the plugin must restart it). Every 45 minutes, starting 30 minutes in.
 */
const faults = [
  async (round: number) => {
    const feed = feeds[round % feeds.length];
    if (feed === undefined) return;
    run.event("chaos", "publisher-down", { name: feed.name });
    await feed.pause();
    await delay(20_000);
    feed.resume();
    run.event("chaos", "publisher-up", { name: feed.name });
  },
  async (round: number) => {
    const relays = (await systemSnapshot()).processes.filter(
      (info) => info.Name === "moq.exe" && info.ParentProcessId === server.child?.pid,
    );
    const victim = relays[round % Math.max(1, relays.length)];
    if (victim === undefined) return;
    run.event("chaos", "relay-killed", { pid: victim.ProcessId, command: victim.CommandLine });
    killProcesses([victim.ProcessId]);
  },
];
let round = 0;
const chaosStart = Date.now() + 30 * 60_000;
async function chaos(): Promise<void> {
  if (values["no-chaos"] || Date.now() < chaosStart + round * 45 * 60_000) return;
  const fault = faults[round % faults.length];
  round += 1;
  await fault?.(Math.floor((round - 1) / faults.length));
}

const cancels = [
  every(run, "harness", 30_000, sampleSystem),
  every(run, "harness", 15 * 60_000, () => writeReport(run.dir)),
  every(run, "chaos", 60_000, chaos),
];

const deadline = run.startedAt + hours * 3_600_000;
const stopFile = join(run.dir, "STOP");
await new Promise<void>((resolve) => {
  const check = setInterval(() => {
    if (Date.now() < deadline && !existsSync(stopFile)) return;
    clearInterval(check);
    resolve();
  }, 5_000);
  process.once("SIGINT", () => {
    clearInterval(check);
    resolve();
  });
});

run.event("harness", "run-ending", { stopFile: existsSync(stopFile) });
for (const cancel of cancels) cancel();
await monitor.stop();
await Promise.all([relay.stop(), watcher.stop()]);
await server.stop();
await Promise.all(feeds.map((feed) => feed.stop()));
await media.stop();
await obs.stop();
run.event("harness", "run-ended");
await writeReport(run.dir);
await run.close();
process.exit(0);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
