/**
 * The `moq` kind for `vignette/obs`. An OBS with the MoQ plugin gets its native `moq_source` input.
 * Any other OBS gets a stock media source (`ffmpeg_source`) playing RTMP from a local
 * [`moq`](https://github.com/moq-dev/moq) CLI that subscribes to the broadcast and serves it.
 *
 * ```sh
 * vignette obs https://show.example.com/stream --source @vignette/moq/obs
 * ```
 *
 * The relay runs `moq` from `PATH`, or the executable named by `VIGNETTE_MOQ_CLI`.
 *
 * @module
 */
import { spawn, type ChildProcess } from "node:child_process";
import { connect } from "node:net";
import process from "node:process";
import type { ObsHandle, ObsInput, ObsPluginContext, ObsSourcePlugin } from "vignette/obs";

import type { Moq } from "./index.js";

type MoqSource = Parameters<typeof moqObs.create>[0];
type MoqProps = MoqSource["props"];

/**
 * Renders `moq` sources in OBS: the native `moq_source` input when OBS advertises it, otherwise a
 * media source fed by a `moq` CLI relay this plugin runs for the source's lifetime.
 */
export const moqObs: ObsSourcePlugin<typeof Moq> = {
  kind: "moq",
  create(source, context) {
    return context.inputKinds.has("moq_source") ? native(source) : relayed(source, context);
  },
};

/** The native input; without `update`, changed props re-create it. */
function native(source: MoqSource): ObsHandle<typeof Moq> {
  const { props } = source;
  return {
    input: {
      kind: "moq_source",
      settings: {
        url: props.url,
        broadcast: props.broadcast,
        latency_ms: props.latencyMs,
        video: props.video,
        audio: props.audio,
        quality: props.quality,
        disable_when_hidden: props.disableWhenHidden,
      },
    },
  };
}

/**
 * A `moq` relay on a free local port, played by a media source. The relay restarts on the same
 * port only when what it subscribes to changes, so the OBS input keeps its settings and OBS
 * reconnects by itself. `video: false` cannot drop the track here: a media source always shows it.
 */
async function relayed(
  source: MoqSource,
  context: ObsPluginContext,
): Promise<ObsHandle<typeof Moq>> {
  const address = `127.0.0.1:${String(await context.port())}`;
  let props = source.props;
  let relay = await startRelay(source.id, props, address, context.signal);
  return {
    get input() {
      return relayInput(props, address);
    },
    async update(next) {
      const previous = props;
      props = next.props;
      if (relayArgs(previous, address).join(" ") === relayArgs(props, address).join(" ")) return;
      await relay.stop();
      relay = await startRelay(next.id, props, address, context.signal);
    },
    dispose: () => relay.stop(),
  };
}

function relayInput(props: MoqProps, address: string): ObsInput {
  return {
    kind: "ffmpeg_source",
    settings: {
      input: `rtmp://${address}/live/${encodeURIComponent(props.broadcast)}`,
      is_local_file: false,
      // The relay may restart; reconnect quickly rather than after OBS's 10 s default.
      reconnect_delay_sec: 1,
      // `moq` subscribes only while a player is connected, so this stops the download too.
      close_when_inactive: props.disableWhenHidden,
    },
    muted: !props.audio,
  };
}

/** `moq --connect <relay> --broadcast <name> export [--video-name q] rtmp --listen <address>`. */
function relayArgs(props: MoqProps, address: string): string[] {
  const rendition = props.quality === "auto" ? [] : ["--video-name", props.quality];
  return [
    ["--connect", props.url, "--broadcast", props.broadcast, "export"],
    rendition,
    ["rtmp", "--listen", address, "--max-age", `${String(props.latencyMs)}ms`],
  ].flat();
}

interface Relay {
  stop(): Promise<void>;
}

/**
 * Every running `moq`, killed when this process exits without disposing its target (an uncaught
 * error, `process.exit`), so relays never outlive `vignette obs`. SIGKILL still can.
 */
const running = new Set<ChildProcess>();
let exitHook = false;

function track(child: ChildProcess): void {
  running.add(child);
  child.once("exit", () => running.delete(child));
  if (exitHook) return;
  exitHook = true;
  process.once("exit", () => {
    for (const relay of running) relay.kill("SIGKILL");
  });
}

/** A running `moq` and the last of its log, for error messages. */
interface RelayProcess {
  readonly child: ChildProcess;
  readonly startedAt: number;
  tail(): string;
}

/**
 * Starts `moq` and resolves once its RTMP listener accepts connections. Rejects when `moq` is
 * missing or exits first. Afterwards an unexpected exit restarts it, waiting 1 s and doubling up
 * to 10 s while runs keep ending within 10 s, until `stop` or `signal`.
 */
async function startRelay(
  sourceId: string,
  props: MoqProps,
  address: string,
  signal: AbortSignal,
): Promise<Relay> {
  const command = process.env.VIGNETTE_MOQ_CLI ?? "moq";
  const args = relayArgs(props, address);
  let stopped = false;
  let current = spawnRelay(command, args);
  let restart: ReturnType<typeof setTimeout> | undefined = undefined;

  const stop = async () => {
    stopped = true;
    signal.removeEventListener("abort", onAbort);
    clearTimeout(restart);
    await terminate(current.child);
  };
  const onAbort = () => {
    void stop();
  };
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    await listening(current, address, command);
  } catch (error) {
    await stop();
    throw error;
  }

  let delay = 1_000;
  const supervise = (running: RelayProcess) => {
    running.child.once("exit", (code, exitSignal) => {
      if (stopped) return;
      if (Date.now() - running.startedAt >= 10_000) delay = 1_000;
      const reason = exitSignal ?? `code ${String(code)}`;
      process.stderr.write(
        `@vignette/moq: relay for source '${sourceId}' exited (${reason}); restarting in ${String(delay / 1_000)} s. ${running.tail()}\n`,
      );
      restart = setTimeout(() => {
        if (stopped) return;
        current = spawnRelay(command, args);
        supervise(current);
      }, delay);
      delay = Math.min(delay * 2, 10_000);
    });
  };
  supervise(current);
  return { stop };
}

function spawnRelay(command: string, args: readonly string[]): RelayProcess {
  // Plain log lines: they end up in error messages.
  const child = spawn(command, args, {
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, NO_COLOR: "1" },
  });
  let tail = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    tail = (tail + chunk).slice(-2_000);
  });
  // A spawn failure also arrives as `exit`-less `error`; `listening` reports it.
  child.on("error", () => undefined);
  track(child);
  return {
    child,
    startedAt: Date.now(),
    tail: () => tail.trim(),
  };
}

/** Resolves once `address` accepts a TCP connection; rejects if `moq` fails or exits first. */
function listening(relay: RelayProcess, address: string, command: string): Promise<void> {
  const { child } = relay;
  const [host = "127.0.0.1", port = "0"] = address.split(":");
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error === undefined) resolve();
      else reject(error);
    };
    const onError = (error: NodeJS.ErrnoException) => {
      finish(
        error.code === "ENOENT"
          ? new Error(
              `The '${command}' executable was not found. Install moq-cli (https://github.com/moq-dev/moq) or set VIGNETTE_MOQ_CLI.`,
            )
          : error,
      );
    };
    const onExit = (code: number | null) => {
      finish(
        new Error(`moq exited with code ${String(code)} before serving RTMP. ${relay.tail()}`),
      );
    };
    const timeout = setTimeout(() => {
      finish(new Error(`moq did not listen on ${address} within 10 s. ${relay.tail()}`));
    }, 10_000);
    child.once("error", onError);
    child.once("exit", onExit);
    const probe = () => {
      if (done) return;
      const socket = connect(Number(port), host);
      socket.once("connect", () => {
        socket.destroy();
        finish();
      });
      socket.once("error", () => {
        socket.destroy();
        setTimeout(probe, 100);
      });
    };
    probe();
  });
}

/** SIGTERM, then SIGKILL if `child` has not exited within 2 s. */
async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 2_000);
  await exited;
  clearTimeout(timer);
}
