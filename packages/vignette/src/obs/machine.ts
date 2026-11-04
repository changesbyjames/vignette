import {
  and,
  assign,
  fromCallback,
  fromPromise,
  raise,
  setup,
  stateIn,
  type EventObject,
} from "xstate";

import type { Item, Snapshot } from "../core/snapshot.js";
import { asError } from "../target/kernel-machine.js";
import { ObsPreflightError, readObsErrorCode } from "./errors.js";
import type { ObservedObsState } from "./observed-state.js";
import type { ObsPlan } from "./operations.js";
import { planObsUpdate, type ObsPlanResult } from "./planner.js";
import type { ObsHandle } from "./plugin.js";
import type { ObsConnectionInfo } from "./transport.js";

/** obs-websocket close code for a session OBS invalidated; reconnecting would be refused. */
export const SESSION_INVALIDATED = 4011;
/** obs-websocket request status: OBS is not ready to perform the request yet. */
export const NOT_READY = 207;

/** The snapshot to converge and the live handles it was applied with. */
export interface ObsDesired {
  readonly snapshot: Snapshot;
  readonly handles: ReadonlyMap<string, ObsHandle>;
  /** Layer kinds with a plugin, whose items are handed over rather than transformed. */
  readonly layers?: ReadonlySet<string>;
  /** What each handed-over placement was last placed with; the target's placement runner keeps it. */
  readonly placed?: ReadonlyMap<string, Item>;
}

/** Fixed at creation. */
export interface ObsMachineInput {
  /** "Not ready" answers retried before the failure counts as a connection failure. */
  readonly maximumNotReady: number;
}

/** What the machine knows; async work lives in its actors. */
export interface ObsMachineContext extends ObsMachineInput {
  readonly desired?: ObsDesired;
  /** The show this target manages, bound by the first snapshot. */
  readonly show?: string;
  /** The latest observation of OBS. */
  readonly observed?: ObservedObsState;
  /** The plan made on entering `planning`. */
  readonly result?: ObsPlanResult;
  /** Incremented on every observation and carried into `execute`. */
  readonly epoch: number;
  readonly outcome?: ObsOutcome;
  /** `activeScene` of the last settled snapshot; the program scene is set only on change. */
  readonly settledActiveScene?: string;
  /** Connection failures since the last successful connect. */
  readonly attempt: number;
  /** "Not ready" answers since the last settled convergence. */
  readonly notReady: number;
  /** The last connection failure, or the terminal one. */
  readonly error?: Error;
}

/** Input of the `execute` actor; its output is the epoch it ran for. */
export interface ExecuteInput {
  readonly plan: ObsPlan;
  readonly epoch: number;
}

/** How convergence towards `desired` last ended: settled, or failed with `error`. */
export interface ObsOutcome {
  readonly desired: ObsDesired;
  readonly error?: Error;
}

/** The kernel asked for a snapshot to be applied with its live handles. */
export interface ApplyEvent extends ObsDesired {
  readonly type: "apply";
}
/** OBS changes scene collection, has loaded one, or changed scenes, inputs or items. */
export interface ObsChangeEvent {
  readonly type: "collectionChanging" | "collectionChanged" | "remoteChanged";
}
/** The websocket closed with `code`. */
export interface ClosedEvent {
  readonly type: "closed";
  readonly code?: number;
  readonly error: Error;
}
/** A request failed in a way that needs a new connection; raised by the machine itself. */
export interface LostEvent {
  readonly type: "lost";
  readonly error: Error;
}
/** The `timer` actor fired. */
export interface TimerEvent {
  readonly type: "timer";
}

/** What the `events` actor sends. */
export type ObsTransportEvent = ObsChangeEvent | ClosedEvent;
/** Everything the OBS machine reacts to. */
export type ObsMachineEvent = ApplyEvent | ObsTransportEvent | LostEvent | TimerEvent;

/**
 * OBS connection and convergence (plan §6.3) as two parallel regions. `connection` connects once
 * there is something to apply, reconnects with backoff, and stops for good when OBS invalidates
 * the session (4011). `convergence` observes, plans (a pure assign on entering `planning`),
 * executes, and re-observes until a plan is empty: `settled`. Planning problems are `failed`;
 * both record an `outcome` for the desired snapshot, which `obsTarget`'s `update` waits for.
 * A "not ready" answer (207) pauses and retries, a scene collection switch pauses until it is
 * loaded, and a change in OBS re-observes. Leaving a state stops its actors, so a stale
 * observation or execution never reports; `execute` also stops between operations then.
 *
 * `obsTarget` provides the I/O: `connect`, `disconnect`, `observe` (input: the show), `execute`,
 * `events` (sends {@link ObsTransportEvent}s while connected) and `timer` (input: the backoff
 * attempt; sends `timer`).
 */
export const obsMachine = setup({
  types: {
    // SAFETY: XState reads these three only as type carriers.
    context: {} as ObsMachineContext,
    // SAFETY: as above.
    events: {} as ObsMachineEvent,
    // SAFETY: as above.
    input: {} as ObsMachineInput,
  },
  actors: {
    connect: fromPromise<ObsConnectionInfo>(missing),
    disconnect: fromPromise<undefined>(missing),
    observe: fromPromise<ObservedObsState, string>(missing),
    execute: fromPromise<number, ExecuteInput>(missing),
    events: fromCallback<EventObject>(missing),
    timer: fromCallback<EventObject, number>(missing),
  },
  guards: {
    canObserve: and([
      stateIn({ connection: "connected" }),
      ({ context }) => context.desired !== undefined,
    ]),
    stale: ({ context }) => context.outcome?.desired !== context.desired,
    retryNotReady: ({ context, event }) =>
      "error" in event &&
      readObsErrorCode(event.error) === NOT_READY &&
      context.notReady < context.maximumNotReady,
  },
  actions: {
    countNotReady: assign({ notReady: ({ context }) => context.notReady + 1 }),
    resetNotReady: assign({ notReady: 0 }),
    lose: raise(({ event }) => ({
      type: "lost" as const,
      error: asError("error" in event ? event.error : undefined, "An OBS request failed."),
    })),
    setError: assign({
      error: ({ event }) => asError("error" in event ? event.error : undefined, "OBS failed."),
    }),
    plan: assign({
      result: ({ context: { desired, observed, settledActiveScene, outcome } }) =>
        desired === undefined || observed === undefined
          ? missing()
          : planObsUpdate({
              desired: desired.snapshot,
              handles: desired.handles,
              observed,
              settledActiveScene,
              layers: desired.layers,
              placed: desired.placed,
              previous: outcome?.desired.snapshot,
            }),
    }),
  },
}).createMachine({
  id: "obs",
  type: "parallel",
  context: ({ input }) => ({ ...input, epoch: 0, attempt: 0, notReady: 0 }),
  on: {
    apply: {
      actions: assign({
        desired: ({ event: { snapshot, handles, layers, placed } }) => ({
          snapshot,
          handles,
          layers,
          placed,
        }),
        show: ({ context, event }) => context.show ?? event.snapshot.id,
      }),
    },
  },
  states: {
    connection: {
      initial: "disconnected",
      states: {
        disconnected: {
          always: { guard: ({ context }) => context.desired !== undefined, target: "connecting" },
        },
        connecting: {
          invoke: {
            src: "connect",
            onDone: "connected",
            onError: { target: "retry-wait", actions: "setError" },
          },
        },
        connected: {
          entry: assign({ attempt: 0, error: undefined }),
          invoke: { src: "events" },
          on: {
            closed: [
              {
                guard: ({ event }) => event.code === SESSION_INVALIDATED,
                target: "terminal",
                actions: "setError",
              },
              { target: "retry-wait", actions: "setError" },
            ],
            lost: { target: "retry-wait", actions: "setError" },
          },
        },
        "retry-wait": {
          invoke: [
            { src: "disconnect" },
            { src: "timer", input: ({ context }) => context.attempt },
          ],
          exit: assign({ attempt: ({ context }) => context.attempt + 1 }),
          on: { timer: "connecting" },
        },
        terminal: {},
      },
    },
    convergence: {
      initial: "idle",
      on: { closed: ".idle", lost: ".idle", collectionChanging: ".paused.collection" },
      states: {
        idle: { always: { guard: "canObserve", target: "observing" } },
        observing: {
          entry: assign({ epoch: ({ context }) => context.epoch + 1 }),
          invoke: {
            src: "observe",
            input: ({ context }) => context.desired?.snapshot.id ?? missing(),
            onDone: {
              target: "planning",
              actions: assign({ observed: ({ event }) => event.output }),
            },
            onError: [
              // "Not ready" pauses and retries; anything else needs a new connection.
              { guard: "retryNotReady", target: "paused.notReady", actions: "countNotReady" },
              { actions: ["resetNotReady", "lose"] },
            ],
          },
          on: { remoteChanged: { target: "observing", reenter: true } },
        },
        planning: {
          entry: "plan",
          always: [
            { guard: ({ context }) => context.result?.ok === false, target: "failed" },
            {
              guard: ({ context }) =>
                context.result?.ok === true && context.result.plan.operations.length === 0,
              target: "settled",
            },
            { target: "executing" },
          ],
        },
        executing: {
          invoke: {
            src: "execute",
            input: ({ context: { result, epoch } }) =>
              result?.ok === true ? { plan: result.plan, epoch } : missing(),
            // Executed or interrupted: re-read OBS, then plan again until nothing is left to do.
            onDone: {
              guard: ({ context, event }) => event.output === context.epoch,
              target: "observing",
            },
            onError: [
              // "Not ready" pauses and retries; anything else needs a new connection.
              { guard: "retryNotReady", target: "paused.notReady", actions: "countNotReady" },
              { actions: ["resetNotReady", "lose"] },
            ],
          },
        },
        settled: {
          entry: assign(({ context }) => ({
            outcome: context.desired === undefined ? undefined : { desired: context.desired },
            settledActiveScene: context.desired?.snapshot.activeScene,
            notReady: 0,
          })),
          always: { guard: "stale", target: "planning" },
          on: { remoteChanged: "observing" },
        },
        failed: {
          entry: assign({
            outcome: ({ context: { desired, result } }) =>
              desired === undefined || result?.ok !== false
                ? undefined
                : { desired, error: new ObsPreflightError(result.problems.join(" ")) },
          }),
          always: { guard: "stale", target: "planning" },
          on: { remoteChanged: "observing" },
        },
        paused: {
          initial: "collection",
          states: {
            notReady: {
              invoke: { src: "timer", input: ({ context }) => context.notReady - 1 },
              on: { timer: "#obs.convergence.observing" },
            },
            collection: { on: { collectionChanged: "#obs.convergence.idle" } },
          },
        },
      },
    },
  },
});

/** Placeholder for the I/O `obsTarget` provides, and for state that is always present. */
function missing(): never {
  throw new Error("The OBS machine ran without its I/O or desired state.");
}
