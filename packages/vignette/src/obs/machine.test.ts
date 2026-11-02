import { describe, expect, it } from "vitest";
import { createActor, fromCallback, fromPromise, type EventObject } from "xstate";

import type { Snapshot } from "../core/snapshot.js";
import { ObsRequestError } from "./errors.js";
import { obsMachine, type ExecuteInput, type ObsTransportEvent } from "./machine.js";
import type { ObservedObsState } from "./observed-state.js";

function snapshot(revision: number, activeScene?: string): Snapshot {
  return {
    revision,
    id: "show",
    canvas: { width: 1920, height: 1080 },
    activeScene,
    sources: [],
    scenes: [{ id: "main", items: [] }],
  };
}

/** An OBS without the show: planning it creates the registry and `main`. */
const empty: ObservedObsState = {
  show: "show",
  inputKinds: [],
  missingRequests: [],
  scenes: [],
  inputs: [],
  sceneItems: [],
};
/** An OBS that matches `snapshot(n, "main")`: planning it yields nothing. */
const converged: ObservedObsState = {
  ...empty,
  programSceneName: "vignette/show/main",
  scenes: [
    { sceneName: "vignette/show", sceneUuid: "registry" },
    { sceneName: "vignette/show/main", sceneUuid: "main" },
  ],
};

const notReady = () => new ObsRequestError("GetVersion", 207, "Not ready.");

/** One `execute` in flight; the test decides when it finishes. */
interface Execution {
  readonly input: ExecuteInput;
  readonly signal: AbortSignal;
  finish(): void;
}

/** One running `timer`; `fire` sends `timer` if it is still running. */
interface Timer {
  readonly attempt: number;
  live: boolean;
  fire(): void;
}

/**
 * Runs the machine with fake I/O. `observations` answer `observe` in order (an `Error` rejects),
 * then `converged`; `connectFailures` connects are refused first.
 */
function run(observations: (ObservedObsState | Error)[] = [], connectFailures = 0) {
  const executions: Execution[] = [];
  const timers: Timer[] = [];
  const observed: string[] = [];
  let send: ((event: ObsTransportEvent) => void) | undefined = undefined;
  let refusals = connectFailures;
  const machine = obsMachine.provide({
    actors: {
      connect: fromPromise(() =>
        refusals-- > 0
          ? Promise.reject(new Error("refused"))
          : Promise.resolve({ obsWebSocketVersion: "5", negotiatedRpcVersion: 1 }),
      ),
      disconnect: fromPromise(() => Promise.resolve(undefined)),
      observe: fromPromise(({ input }) => {
        observed.push(input);
        const next = observations.shift() ?? converged;
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
      }),
      execute: fromPromise(
        ({ input, signal }) =>
          new Promise((resolve) => {
            executions.push({
              input,
              signal,
              finish: () => {
                resolve(input.epoch);
              },
            });
          }),
      ),
      events: fromCallback<EventObject>(({ sendBack }) => {
        send = sendBack;
        return () => {
          send = undefined;
        };
      }),
      timer: fromCallback<EventObject, number>(({ input, sendBack }) => {
        const timer: Timer = {
          attempt: input,
          live: true,
          fire: () => {
            if (timer.live) sendBack({ type: "timer" });
          },
        };
        timers.push(timer);
        return () => {
          timer.live = false;
        };
      }),
    },
  });
  const actor = createActor(machine, { input: { maximumNotReady: 2 } }).start();
  const state = () => actor.getSnapshot();
  return {
    actor,
    executions,
    timers,
    observed,
    emit: (event: ObsTransportEvent) => send?.(event),
    apply: (revision: number, activeScene: string | undefined = "main") => {
      actor.send({ type: "apply", snapshot: snapshot(revision, activeScene), handles: new Map() });
    },
    /** `{ connection, convergence }` as plain state names. */
    at: () => state().value,
    context: () => state().context,
  };
}

/** Lets fake actors settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("OBS machine", () => {
  it("stays disconnected until there is something to apply", async () => {
    const obs = run();
    await flush();
    expect(obs.at()).toEqual({ connection: "disconnected", convergence: "idle" });
  });

  it("connects, observes, executes, re-observes and settles once a plan is empty", async () => {
    const obs = run([empty]);
    obs.apply(1);
    await flush();
    expect(obs.at()).toEqual({ connection: "connected", convergence: "executing" });
    expect(obs.executions[0]?.input.epoch).toBe(1);
    expect(obs.executions[0]?.input.plan.operations.map((operation) => operation.kind)).toEqual([
      "create-scene",
      "create-scene",
      "set-program-scene",
    ]);

    obs.executions[0]?.finish();
    await flush();
    expect(obs.at()).toEqual({ connection: "connected", convergence: "settled" });
    expect(obs.context().epoch).toBe(2);
    expect(obs.context().outcome).toEqual({ desired: obs.context().desired });
    expect(obs.context().settledActiveScene).toBe("main");
  });

  it("plans a new snapshot against the current observation without re-reading OBS", async () => {
    const obs = run();
    obs.apply(1);
    await flush();
    obs.apply(2);
    await flush();
    expect(obs.observed).toHaveLength(1);
    expect(obs.context().outcome?.desired.snapshot.revision).toBe(2);
  });

  it("drops the result of an execution whose epoch was left behind", async () => {
    const obs = run([empty]);
    obs.apply(1);
    await flush();
    const [stale] = obs.executions;
    obs.emit({ type: "collectionChanging" });
    expect(obs.at()).toEqual({ connection: "connected", convergence: { paused: "collection" } });
    expect(stale?.signal.aborted).toBe(true);

    stale?.finish();
    await flush();
    expect(obs.at()).toEqual({ connection: "connected", convergence: { paused: "collection" } });
    expect(obs.context().outcome).toBeUndefined();

    obs.emit({ type: "collectionChanged" });
    await flush();
    expect(obs.at()).toEqual({ connection: "connected", convergence: "settled" });
    expect(obs.context().epoch).toBe(2);
  });

  it("pauses on 207 not-ready with a growing backoff, then reconnects after the maximum", async () => {
    const obs = run([notReady(), notReady(), notReady()]);
    obs.apply(1);
    await flush();
    expect(obs.at()).toEqual({ connection: "connected", convergence: { paused: "notReady" } });
    obs.timers.at(-1)?.fire();
    await flush();
    expect(obs.at()).toEqual({ connection: "connected", convergence: { paused: "notReady" } });
    obs.timers.at(-1)?.fire();
    await flush();
    // The third "not ready" exceeds the maximum of two: drop the connection and back off.
    expect(obs.at()).toEqual({ connection: "retry-wait", convergence: "idle" });
    expect(obs.timers.map((timer) => timer.attempt)).toEqual([0, 1, 0]);
    expect(obs.context().notReady).toBe(0);

    obs.timers.at(-1)?.fire();
    await flush();
    expect(obs.at()).toEqual({ connection: "connected", convergence: "settled" });
  });

  it("backs off with a growing attempt until a connect succeeds", async () => {
    const obs = run([], 2);
    obs.apply(1);
    await flush();
    expect(obs.at()).toEqual({ connection: "retry-wait", convergence: "idle" });
    expect(obs.context().error?.message).toBe("refused");
    obs.timers.at(-1)?.fire();
    await flush();
    obs.timers.at(-1)?.fire();
    await flush();
    expect(obs.timers.map((timer) => timer.attempt)).toEqual([0, 1]);
    expect(obs.at()).toEqual({ connection: "connected", convergence: "settled" });
    expect(obs.context()).toMatchObject({ attempt: 0, error: undefined });
  });

  it("stops for good when OBS invalidates the session (4011)", async () => {
    const obs = run([empty]);
    obs.apply(1);
    await flush();
    const error = new Error("invalidated");
    obs.emit({ type: "closed", code: 4011, error });
    expect(obs.at()).toEqual({ connection: "terminal", convergence: "idle" });
    expect(obs.context().error).toBe(error);
    obs.apply(2);
    await flush();
    expect(obs.at()).toEqual({ connection: "terminal", convergence: "idle" });
  });

  it("reconnects after any other close", async () => {
    const obs = run();
    obs.apply(1);
    await flush();
    obs.emit({ type: "closed", code: 1006, error: new Error("gone") });
    expect(obs.at()).toEqual({ connection: "retry-wait", convergence: "idle" });
    obs.timers.at(-1)?.fire();
    await flush();
    expect(obs.at()).toEqual({ connection: "connected", convergence: "settled" });
  });

  it("re-observes after a change in OBS, carrying the settled active scene", async () => {
    const obs = run();
    obs.apply(1);
    await flush();
    obs.emit({ type: "remoteChanged" });
    expect(obs.at()).toEqual({ connection: "connected", convergence: "observing" });
    await flush();
    expect(obs.observed).toHaveLength(2);
    expect(obs.at()).toEqual({ connection: "connected", convergence: "settled" });
  });

  it("fails a snapshot with planning problems but stays connected", async () => {
    const obs = run([{ ...converged, missingRequests: ["CreateScene"] }]);
    obs.apply(1);
    await flush();
    expect(obs.at()).toEqual({ connection: "connected", convergence: "failed" });
    expect(obs.context().outcome?.error?.message).toContain("'CreateScene'");
  });
});
