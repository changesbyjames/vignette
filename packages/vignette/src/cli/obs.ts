import { obsTarget } from "../obs/target.js";
import type { ObsTransport } from "../obs/transport.js";
import { fromSse } from "../stream/sse.js";
import type { TargetStatus } from "../target/status.js";
import { loadPlugins } from "./load-plugins.js";

/** Options of {@link runObs}. */
export interface RunObsOptions {
  /** The stream's server-sent events URL. */
  readonly stream: string;
  /** obs-websocket URL; the target's default when omitted. */
  readonly obsUrl?: string;
  readonly password?: string;
  /** Plugin module specifiers, resolved from the working directory. */
  readonly sources: readonly string[];
  /** Keeps the files OBS loads here instead of the user's cache directory. */
  readonly dir?: string;
  /** Runs until this aborts, then disposes the target. */
  readonly signal: AbortSignal;
  /** Internal: how requests reach OBS. Tests pass `FakeObs`. */
  readonly transport?: ObsTransport;
}

/**
 * `vignette obs <stream-url>`: follows the stream with an OBS target until `signal` aborts. The
 * target binds to the stream's show and learns asset and frame locations from its setup.
 */
export async function runObs(options: RunObsOptions): Promise<void> {
  const { signal } = options;
  const target = obsTarget({
    url: options.obsUrl,
    password: options.password,
    sources: await loadPlugins([...options.sources], process.cwd()),
    dir: options.dir,
    transport: options.transport,
  });
  let last = "";
  const report = () => {
    const line = describeStatus(target.status);
    if (line === last) return;
    last = line;
    process.stderr.write(`${line}\n`);
  };
  const unsubscribe = target.subscribe(report);
  report();
  target.follow(fromSse(options.stream, { signal }));
  try {
    await aborted(signal);
  } finally {
    unsubscribe();
    await target.dispose();
  }
}

/**
 * One status line: the phase, asset progress while downloading, the settled revision, the OBS
 * connection unless it is open (with why it failed), sources still preparing, failed sources with
 * why, and any error.
 */
export function describeStatus(status: TargetStatus): string {
  const parts = [`obs: ${status.phase}`];
  if (status.phase === "downloading-assets" && status.assets !== undefined) {
    parts.push(`${String(status.assets.done)}/${String(status.assets.total)} assets`);
  }
  if (status.phase === "settled" && status.revision.settled !== undefined) {
    parts.push(`r${String(status.revision.settled)}`);
  }
  const { connection } = status;
  if (connection !== undefined && connection.phase !== "open") {
    const reason = connection.error === undefined ? "" : `: ${connection.error.message}`;
    parts.push(`(${connection.phase}${reason})`);
  }
  parts.push(...describeSources(status));
  if (status.error !== undefined) parts.push(`- ${status.error.message}`);
  return parts.join(" ");
}

/** Sources still preparing, then each failed source with why. */
function describeSources(status: TargetStatus): string[] {
  const parts: string[] = [];
  const preparing = Object.keys(status.sources).filter((id) => status.sources[id] === "preparing");
  if (preparing.length > 0) {
    const more = preparing.length > 3 ? ` and ${String(preparing.length - 3)} more` : "";
    parts.push(`(preparing ${preparing.slice(0, 3).join(", ")}${more})`);
  }
  for (const [id, error] of Object.entries(status.sourceErrors)) {
    parts.push(`- source '${id}' failed: ${error.message}`);
  }
  return parts;
}

function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener(
      "abort",
      () => {
        resolve();
      },
      { once: true },
    );
  });
}
