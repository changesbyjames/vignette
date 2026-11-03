import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { OBSWebSocket } from "obs-websocket-js";
import { z } from "zod";

import { FEEDS, GUEST_FEED, SHOW_ID } from "../feeds.js";
import type { Run } from "./log.js";
import { PROGRAM_PATH } from "./media.js";
import type { StreamSample } from "./samples.js";
import { every, supervise, type Supervised } from "./supervise.js";

/** The soak's own scene collection and profile in the isolated OBS. */
const COLLECTION = "vignette-soak";
const PROFILE = "vignette-soak";

export interface ObsOptions {
  /** The isolated OBS's `obs64.exe`. */
  readonly exe: string;
  readonly url: string;
  readonly password: string;
  /** Video bitrate in kbps; Twitch's guidance for 1080p60 is 6000. */
  readonly bitrate: number;
}

/**
 * The isolated OBS, started by the harness so a crash is seen and restarted. Portable mode keeps
 * its settings in its own folder; `--multi` lets it run beside the user's OBS.
 */
export function obsProcess(run: Run, options: ObsOptions): Supervised {
  return supervise(run, "obs", {
    start: () =>
      spawn(
        options.exe,
        [
          "--portable",
          "--multi",
          "--disable-shutdown-check",
          "--disable-updater",
          "--minimize-to-tray",
        ],
        { cwd: dirname(options.exe), stdio: "ignore" },
      ),
  });
}

const InputListSchema = z.object({ inputs: z.array(z.object({ inputName: z.string() })) });
type InputList = z.output<typeof InputListSchema>;

/** A byte counter's value at one time. */
interface ByteCount {
  readonly at: number;
  readonly bytes: number;
}

/** The managed OBS input name of a show source. */
export const inputName = (sourceId: string) => `vignette/${SHOW_ID}/${sourceId}`;
const sceneId = (name: string) => name.slice(`vignette/${SHOW_ID}/`.length);

export interface ObsMonitor {
  /** Resolves once OBS is connected and set up for the soak. */
  ready(): Promise<void>;
  /** From now on, keep OBS streaming to MediaMTX. */
  stream(): void;
  /** The server asked for `scene`; the switch is timed until OBS reports it on program. */
  sceneRequested(scene: string): void;
  stop(): Promise<void>;
}

const SAMPLE_MS = 5_000;
const FEED_MS = 30_000;
const SCREENSHOT_MS = 60_000;
/** How long OBS may go without answering before the monitor reports it unresponsive. */
const UNRESPONSIVE_MS = 90_000;

/** Rejects if `promise` has not settled within `ms`: a crashed OBS can leave requests hanging. */
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`OBS did not answer ${what} within ${String(ms / 1000)} s.`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Connects to OBS and keeps reconnecting. On every connect it selects the soak's collection and
 * profile, sets 1080p60 video, the AMD hardware encoder at `bitrate`, MediaMTX as the stream
 * server, and mutes every audio input outside the show so nothing on the desktop reaches Twitch.
 * Then it samples `GetStats` and `GetStreamStatus` every 5 s, each feed's media state every 30 s
 * and a thumbnail of each feed every minute (identical thumbnails mean a frozen feed), times scene
 * switches, and restarts the stream if it stops. When OBS answers nothing for 90 s, e.g. because
 * it sits in its crash dialog, it calls `onUnresponsive`, which should kill it.
 */
export function obsMonitor(run: Run, options: ObsOptions, onUnresponsive: () => void): ObsMonitor {
  const obs = new OBSWebSocket();
  let stopped = false;
  let connected = false;
  let wantStream = false;
  let starting = false;
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const requestedAt = new Map<string, number>();
  const thumbnails = new Map<string, string>();
  const frozen = new Set<string>();
  let healthyAt = Date.now();

  obs.on("ConnectionClosed", (error) => {
    if (!connected) return;
    connected = false;
    run.event("obs", "websocket-closed", { code: error.code, message: error.message });
    if (!stopped) setTimeout(() => void connect(), 5_000);
  });
  obs.on("CurrentProgramSceneChanged", ({ sceneName }) => {
    const scene = sceneId(sceneName);
    const at = requestedAt.get(scene);
    requestedAt.delete(scene);
    run.sample("scene-switch", {
      scene,
      latencyMs: at === undefined ? undefined : Date.now() - at,
    });
  });
  obs.on("StreamStateChanged", ({ outputActive, outputState }) => {
    run.event("obs", "stream-state", { outputActive, outputState });
  });
  obs.on("CurrentSceneCollectionChanged", ({ sceneCollectionName }) => {
    run.event("obs", "collection-changed", { sceneCollectionName });
  });
  obs.on("ExitStarted", () => {
    run.event("obs", "exit-started");
  });
  let created = 0;
  let removed = 0;
  obs.on("InputCreated", () => {
    created += 1;
  });
  obs.on("InputRemoved", () => {
    removed += 1;
  });

  let connecting = false;
  async function connect(): Promise<void> {
    if (connecting) return;
    connecting = true;
    try {
      await connectLoop();
    } finally {
      connecting = false;
    }
  }

  async function connectLoop(): Promise<void> {
    // Retries every 5 s; a connection whose set-up fails is dropped and retried too.
    while (!stopped && !connected) {
      try {
        await obs.connect(options.url, options.password, { rpcVersion: 1 });
        connected = true;
        run.event("obs", "websocket-open");
        await within(setUp(), 60_000, "set-up");
        healthyAt = Date.now();
        resolveReady();
      } catch (error) {
        if (connected) {
          const message = error instanceof Error ? error.message : String(error);
          run.event("obs", "setup-failed", { message });
          await obs.disconnect().catch(() => undefined);
          connected = false;
        }
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
  }

  async function setUp(): Promise<void> {
    await selectCollectionAndProfile();
    const status = await obs.call("GetStreamStatus");
    // Video and output settings cannot change while streaming, e.g. after a websocket blip.
    if (!status.outputActive) await configureOutput();
    await muteOutsiders();
    run.event("obs", "set-up", { collection: COLLECTION, profile: PROFILE });
  }

  /**
   * Creates the soak's collection and profile the first time, and selects them. Each switch
   * finishes on OBS's UI thread after the request returns, so this waits for OBS's event and a
   * moment more: a video reset requested meanwhile races the profile's own and crashes OBS 33.
   */
  async function selectCollectionAndProfile(): Promise<void> {
    const collections = await obs.call("GetSceneCollectionList");
    if (collections.currentSceneCollectionName !== COLLECTION) {
      const switched = next("CurrentSceneCollectionChanged");
      await (collections.sceneCollections.includes(COLLECTION)
        ? obs.call("SetCurrentSceneCollection", { sceneCollectionName: COLLECTION })
        : obs.call("CreateSceneCollection", { sceneCollectionName: COLLECTION }));
      await switched;
    }
    const profiles = await obs.call("GetProfileList");
    if (profiles.currentProfileName !== PROFILE) {
      const switched = next("CurrentProfileChanged");
      await (profiles.profiles.includes(PROFILE)
        ? obs.call("SetCurrentProfile", { profileName: PROFILE })
        : obs.call("CreateProfile", { profileName: PROFILE }));
      await switched;
    }
  }

  /** Resolves 3 s after OBS next emits `event`, or after 20 s without it. */
  function next(event: "CurrentSceneCollectionChanged" | "CurrentProfileChanged"): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(fallback);
        obs.off(event, done);
        setTimeout(resolve, 3_000);
      };
      const fallback = setTimeout(done, 20_000);
      obs.once(event, done);
    });
  }

  /**
   * 1080p60, streaming to MediaMTX. The encoder and reconnect settings are in the profile's files,
   * which the harness writes before starting OBS (`obs-profile.ts`).
   */
  async function configureOutput(): Promise<void> {
    const video = {
      baseWidth: 1920,
      baseHeight: 1080,
      outputWidth: 1920,
      outputHeight: 1080,
      fpsNumerator: 60,
      fpsDenominator: 1,
    };
    const current = await obs.call("GetVideoSettings");
    const same =
      current.baseWidth === video.baseWidth &&
      current.baseHeight === video.baseHeight &&
      current.outputWidth === video.outputWidth &&
      current.outputHeight === video.outputHeight &&
      current.fpsNumerator === video.fpsNumerator &&
      current.fpsDenominator === video.fpsDenominator;
    // Resetting video is what races; the profile keeps these, so it happens once.
    if (!same) await obs.call("SetVideoSettings", video);
    await obs.call("SetStreamServiceSettings", {
      streamServiceType: "rtmp_custom",
      streamServiceSettings: {
        server: "rtmp://127.0.0.1:1935",
        key: PROGRAM_PATH,
        use_auth: false,
      },
    });
  }

  /** Mutes the desktop and mic channels and every other audio input the show does not manage. */
  async function muteOutsiders(): Promise<void> {
    const special = await obs.call("GetSpecialInputs");
    const { inputs }: InputList = InputListSchema.parse(await obs.call("GetInputList"));
    const names = new Set<string>(Object.values(special).filter((name) => name !== ""));
    for (const { inputName: name } of inputs) {
      if (!name.startsWith(`vignette/${SHOW_ID}/`)) names.add(name);
    }
    for (const name of names) {
      const mute = await obs.call("GetInputMute", { inputName: name }).catch(() => undefined);
      if (mute === undefined || mute.inputMuted) continue;
      await obs.call("SetInputMute", { inputName: name, inputMuted: true });
      run.event("obs", "muted-outside-input", { inputName: name });
    }
  }

  let previousStream: ByteCount | undefined = undefined;
  async function sample(): Promise<void> {
    if (!connected) return;
    // The bitrate is the byte count's growth since the last sample; a restarted output resets it.
    const [stats, stream, program] = await Promise.all([
      obs.call("GetStats"),
      obs.call("GetStreamStatus"),
      obs.call("GetCurrentProgramScene"),
    ]);
    const at = Date.now();
    healthyAt = at;
    const kbps =
      previousStream === undefined || stream.outputBytes < previousStream.bytes
        ? undefined
        : ((stream.outputBytes - previousStream.bytes) * 8) / (at - previousStream.at);
    previousStream = { at, bytes: stream.outputBytes };
    run.sample("obs", {
      ...stats,
      stream: { ...stream, kbps },
      program: sceneId(program.currentProgramSceneName),
      inputsCreated: created,
      inputsRemoved: removed,
    });
    created = 0;
    removed = 0;
    await keepStreaming(stream);
  }

  /** Starts the stream when the soak wants it and OBS is neither streaming nor reconnecting. */
  async function keepStreaming(stream: StreamSample): Promise<void> {
    if (!wantStream || stream.outputActive || stream.outputReconnecting || starting) return;
    starting = true;
    run.event("obs", "stream-start");
    await obs.call("StartStream").finally(() => {
      starting = false;
    });
  }

  const feedIds = () => [...FEEDS, GUEST_FEED].map((feed) => feed.id);

  async function sampleFeeds(): Promise<void> {
    if (!connected) return;
    const states: Record<string, string> = {};
    for (const id of feedIds()) {
      const status = await obs
        .call("GetMediaInputStatus", { inputName: inputName(id) })
        .catch(() => undefined);
      if (status !== undefined) states[id] = status.mediaState;
    }
    run.sample("feeds", states);
    await muteOutsiders();
  }

  async function screenshots(): Promise<void> {
    if (!connected) return;
    const result: Record<string, boolean> = {};
    for (const id of feedIds()) {
      const same = await unchanged(id);
      if (same !== undefined) result[id] = same;
    }
    run.sample("frozen", result);
  }

  /**
   * Whether a feed's thumbnail is identical to the previous one, reporting the feed frozen or
   * recovered when that changes. `undefined` while the input does not exist.
   */
  async function unchanged(id: string): Promise<boolean | undefined> {
    const shot = await obs
      .call("GetSourceScreenshot", {
        sourceName: inputName(id),
        imageFormat: "jpg",
        imageWidth: 160,
        imageCompressionQuality: 60,
      })
      .catch(() => undefined);
    if (shot === undefined) {
      thumbnails.delete(id);
      return undefined;
    }
    const hash = createHash("sha1").update(shot.imageData).digest("hex");
    const same = thumbnails.get(id) === hash;
    thumbnails.set(id, hash);
    if (same && !frozen.has(id)) {
      frozen.add(id);
      run.event("obs", "feed-frozen", { id });
    } else if (!same && frozen.delete(id)) {
      run.event("obs", "feed-recovered", { id });
    }
    return same;
  }

  /** Reports OBS unresponsive once it has answered nothing for `UNRESPONSIVE_MS`. */
  async function watchdog(): Promise<void> {
    await Promise.resolve();
    if (stopped || Date.now() - healthyAt < UNRESPONSIVE_MS) return;
    run.event("obs", "unresponsive", { silentForMs: Date.now() - healthyAt });
    // Counts again from now, giving the restarted OBS time to come up.
    healthyAt = Date.now();
    connected = false;
    await obs.disconnect().catch(() => undefined);
    onUnresponsive();
    void connect();
  }

  const cancels = [
    every(run, "obs", SAMPLE_MS, () => within(sample(), 15_000, "the stats requests")),
    every(run, "obs", FEED_MS, () => within(sampleFeeds(), 30_000, "the media status requests")),
    every(run, "obs", SCREENSHOT_MS, () => within(screenshots(), 45_000, "the screenshots")),
    every(run, "obs", 10_000, watchdog),
  ];
  void connect();

  return {
    ready: () => ready,
    stream() {
      wantStream = true;
    },
    sceneRequested(scene) {
      requestedAt.set(scene, Date.now());
    },
    async stop() {
      stopped = true;
      for (const cancel of cancels) cancel();
      if (connected) {
        await obs.call("StopStream").catch(() => undefined);
        await obs.disconnect().catch(() => undefined);
      }
    },
  };
}
