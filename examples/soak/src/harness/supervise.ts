import type { ChildProcess } from "node:child_process";

import type { Run } from "./log.js";

/** A process the harness keeps running, restarting it when it exits. */
export interface Supervised {
  readonly name: string;
  /** The running child, if any. */
  readonly child: ChildProcess | undefined;
  readonly restarts: number;
  /** Kills the child and keeps it down until `resume`. */
  pause(): Promise<void>;
  resume(): void;
  /** Kills the child; the supervisor restarts it as if it had crashed. */
  kill(): void;
  stop(): Promise<void>;
}

export interface SuperviseOptions {
  /** Starts the process. Its stdout and stderr go to `logs/<name>.log` unless already consumed. */
  readonly start: () => ChildProcess;
  /** Waits before starting, e.g. until the input it reads exists. */
  readonly ready?: () => Promise<void>;
  /** Stops the child gracefully; defaults to `kill()`. */
  readonly terminate?: (child: ChildProcess) => void;
}

/**
 * Runs `start()` and restarts it after it exits: 1 s, doubling to 30 s while runs keep ending
 * within a minute. Every start and exit is an event, so restarts are counted in the report.
 */
export function supervise(run: Run, name: string, options: SuperviseOptions): Supervised {
  const log = run.log(name);
  let child: ChildProcess | undefined = undefined;
  let restarts = 0;
  let paused = false;
  let stopped = false;
  let delay = 1_000;
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;
  let launching = false;

  const launch = async () => {
    // Starts the child once it is ready, unless paused, stopped, or already starting or running.
    timer = undefined;
    if (paused || stopped || launching) return;
    launching = true;
    try {
      await options.ready?.();
    } finally {
      launching = false;
    }
    if (paused || stopped || child !== undefined) return;
    const startedAt = Date.now();
    const next = options.start();
    child = next;
    run.event(name, "started", { pid: next.pid });
    next.stdout?.on("data", (chunk: Buffer) => {
      log(chunk.toString());
    });
    next.stderr?.on("data", (chunk: Buffer) => {
      log(chunk.toString());
    });
    next.on("error", (error) => {
      run.event(name, "spawn-error", { message: error.message });
      // A process that never started emits no `exit`; treat it as one so it is retried.
      if (next.pid === undefined) next.emit("exit", null, null);
    });
    next.once("exit", (code, signal) => {
      // An expected exit stays down; any other restarts after the backoff.
      child = undefined;
      const ranFor = Date.now() - startedAt;
      run.event(name, "exited", { code, signal, ranForMs: ranFor, expected: paused || stopped });
      if (paused || stopped) return;
      restarts += 1;
      delay = ranFor >= 60_000 ? 1_000 : Math.min(delay * 2, 30_000);
      timer = setTimeout(() => void launch(), delay);
    });
  };

  const end = async () => {
    clearTimeout(timer);
    timer = undefined;
    const current = child;
    if (current === undefined) return;
    const exited = new Promise((resolve) => current.once("exit", resolve));
    if (options.terminate) options.terminate(current);
    else current.kill();
    const forced = setTimeout(() => current.kill("SIGKILL"), 10_000);
    await exited;
    clearTimeout(forced);
  };

  void launch();
  return {
    name,
    get child() {
      return child;
    },
    get restarts() {
      return restarts;
    },
    async pause() {
      paused = true;
      await end();
    },
    resume() {
      paused = false;
      if (child === undefined && timer === undefined) void launch();
    },
    kill() {
      child?.kill();
    },
    async stop() {
      stopped = true;
      await end();
    },
  };
}

/**
 * Runs `task` every `ms`, skipping a tick while the previous run is still going, and logs a
 * failure as a `task-failed` event from `source` instead of stopping. Returns a cancel function.
 */
export function every(run: Run, source: string, ms: number, task: () => Promise<void>): () => void {
  let busy = false;
  const guarded = async () => {
    try {
      await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      run.event(source, "task-failed", { task: task.name, message });
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void guarded();
  }, ms);
  return () => {
    clearInterval(timer);
  };
}
