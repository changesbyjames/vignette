import {
  and,
  assign,
  enqueueActions,
  fromCallback,
  fromPromise,
  setup,
  stateIn,
  stopChild,
  type EventObject,
} from "xstate";

import type { AssetEntry } from "../core/assets.js";
import type { Snapshot, Source } from "../core/snapshot.js";
import type { SetupMessage, ShowEvent, StreamMessage } from "../stream/messages.js";
import type { TargetHandle } from "./kernel.js";
import type { SourceStatus, TargetAssetProgress, TargetConnection } from "./status.js";

/** What the kernel knows about the target it runs, fixed at creation. */
export interface KernelInput {
  /** The target keeps an asset store, so setup runs the asset stage. */
  readonly assets: boolean;
  /**
   * The kinds the target has plugins for, when it checks them: a snapshot using any other kind
   * fails its revision before any handle is created or the medium renders. Without it, a source
   * of a kind with no plugin fails alone, as its `create` does.
   */
  readonly plugins?: ReadonlySet<string>;
}

/** One source's plugin handle, by source ID. */
export interface HandleEntry<Handle> {
  readonly status: SourceStatus;
  /** Why the source is `error`. */
  readonly error?: Error;
  /** The latest source for this ID. */
  readonly source: Source;
  readonly handle?: Handle;
  /** The source `handle` reflects; the next apply updates the handle when it differs. */
  readonly current?: Source;
}

/** Kernel context. Async work lives in actors; this is only what status and the next apply need. */
export interface KernelContext<Handle> {
  readonly input: KernelInput;
  readonly setup?: SetupMessage;
  /** The snapshot last handed to the medium. */
  readonly snapshot?: Snapshot;
  /** The latest snapshot not yet applied; later updates replace it. */
  readonly pending?: Snapshot;
  readonly plan?: ApplyPlan<Handle>;
  readonly desired?: number;
  readonly settled?: number;
  /** The revision of the last failed apply, until an apply succeeds. */
  readonly failed?: number;
  readonly assets?: TargetAssetProgress;
  readonly handles: ReadonlyMap<string, HandleEntry<Handle>>;
  readonly connection?: TargetConnection;
  /** The failure behind the `error` state, or the last failed apply while ready. */
  readonly error?: Error;
}

/** What the `apply` actor does: settle handles, then render the snapshot. */
export interface ApplyPlan<Handle> {
  readonly snapshot: Snapshot;
  /** Handles whose source ID is gone. */
  readonly disposals: readonly Handle[];
  /** Live handles whose source changed, in order. */
  readonly updates: readonly HandleUpdate<Handle>[];
  /** Every live handle by source ID; a handle whose update fails is left out. */
  readonly handles: ReadonlyMap<string, Handle>;
}

/** A source whose plugin failed, and its error. */
export interface SourceFailure {
  readonly id: string;
  readonly error: Error;
}

/** A live handle and the changed source it must take. */
export interface HandleUpdate<Handle> {
  readonly id: string;
  readonly handle: Handle;
  readonly source: Source;
}

/** The `apply` actor's result. It never rejects: a medium failure is `error`. */
export interface ApplyOutput {
  /** Sources whose handle failed to update, and why; the actor disposed those handles. */
  readonly failed: readonly SourceFailure[];
  readonly error?: Error;
}

/** Input of the `createHandle` actor. */
export interface CreateInput {
  readonly source: Source;
  readonly setup: SetupMessage;
}

/** A setup message arrived. */
export interface SetupEvent {
  readonly type: "setup";
  readonly setup: SetupMessage;
}
/** An update message arrived. */
export interface UpdateEvent {
  readonly type: "update";
  readonly snapshot: Snapshot;
}
/** An event message arrived. */
export interface ShowEventEvent {
  readonly type: "event";
  readonly event: ShowEvent;
}
/** `follow(stream)`: spawn a reader of `stream` named `id`. */
export interface FollowEvent {
  readonly type: "follow";
  readonly id: string;
  readonly stream: AsyncIterable<StreamMessage>;
}
/** `follow`'s stop function. */
export interface UnfollowEvent {
  readonly type: "unfollow";
  readonly id: string;
}
/** A followed stream threw. */
export interface StreamFailedEvent {
  readonly type: "streamFailed";
  readonly error: Error;
}
/** One asset of the asset stage finished. */
export interface AssetProgressEvent {
  readonly type: "assetProgress";
  readonly name: string;
  readonly error?: Error;
}
/** The asset stage finished; `error` when any asset failed. */
export interface AssetsDoneEvent {
  readonly type: "assetsDone";
  readonly error?: Error;
}
/** A plugin's `create` resolved with `handle` for `source`. */
export interface HandleCreatedEvent<Handle> {
  readonly type: "handleCreated";
  readonly id: string;
  readonly handle: Handle;
  readonly source: Source;
}
/** A plugin's `create` rejected. */
export interface HandleFailedEvent {
  readonly type: "handleFailed";
  readonly id: string;
  readonly error: Error;
}
/** The medium reported its connection. */
export interface ConnectionEvent {
  readonly type: "connection";
  readonly connection: TargetConnection;
}
/** `dispose()` was called. */
export interface DisposeEvent {
  readonly type: "dispose";
}

/** Everything the kernel reacts to. */
export type KernelEvent<Handle> =
  | SetupEvent
  | UpdateEvent
  | ShowEventEvent
  | FollowEvent
  | UnfollowEvent
  | StreamFailedEvent
  | AssetProgressEvent
  | AssetsDoneEvent
  | HandleCreatedEvent<Handle>
  | HandleFailedEvent
  | ConnectionEvent
  | DisposeEvent;

/** Params of the `route` action. */
export interface RouteParams<Handle> {
  readonly event: ShowEvent;
  readonly handles: ReadonlyMap<string, Handle>;
}

/**
 * The target kernel (plan §6.2). `createTarget` provides the I/O: `ensureAssets` (sends `assetProgress`/`assetsDone`), `createHandle` (sends `handleCreated`/
 * `handleFailed`; disposes a handle that resolves after it was stopped), `apply`, `connection`
 * and the fire-and-forget `disposeHandles`, `evictAssets` and `route` actions. Superseded work is
 * cancelled by stopping its actor: leaving a state stops its asset stage or apply, and removing a
 * source stops its `create`, so no result needs a generation or token.
 */
export function createKernelMachine<Handle extends TargetHandle>() {
  return setup({
    types: {
      // SAFETY: XState reads these three only as type carriers.
      context: {} as KernelContext<Handle>,
      // SAFETY: as above.
      events: {} as KernelEvent<Handle>,
      // SAFETY: as above.
      input: {} as KernelInput,
    },
    actors: {
      ensureAssets: fromCallback<EventObject, SetupMessage>(missing),
      createHandle: fromCallback<EventObject, CreateInput>(missing),
      apply: fromPromise<ApplyOutput, ApplyPlan<Handle>>(missing),
      connection: fromCallback<EventObject>(() => undefined),
      follow: followStream,
    },
    guards: {
      sameSetup: ({ context, event }) =>
        event.type === "setup" && sameSetup(context.setup, event.setup),
    },
    actions: {
      disposeHandles: (_args, _handles: readonly Handle[]) => missing(),
      evictAssets: (_args, _keep: readonly AssetEntry[]) => missing(),
      route: (_args, _params: RouteParams<Handle>) => missing(),
    },
  }).createMachine({
    id: "kernel",
    context: ({ input }) => ({ input, handles: new Map() }),
    invoke: { src: "connection" },
    initial: "idle",
    on: {
      setup: [
        {
          // A reconnect replays the setup already applied: keep the handles, and let the
          // replayed update converge. Revisions restart, because a restarted composer counts
          // from 1 again. A target that has not got past its asset stage retries.
          guard: and([stateIn("#kernel.ready"), "sameSetup"]),
          actions: assign({ desired: undefined, settled: undefined, failed: undefined }),
        },
        {
          // A new stream: drop everything from the old one and start over.
          target: ".starting",
          reenter: true,
          actions: enqueueActions(({ context, event, enqueue }) => {
            for (const [id, entry] of context.handles) {
              if (entry.status === "preparing") enqueue.stopChild(creatorId(id));
            }
            enqueue({ type: "disposeHandles", params: liveHandles(context.handles) });
            enqueue({ type: "evictAssets", params: event.setup.assets.entries });
            enqueue.assign({
              setup: event.setup,
              handles: new Map(),
              snapshot: undefined,
              pending: undefined,
              plan: undefined,
              assets: undefined,
              desired: undefined,
              settled: undefined,
              failed: undefined,
              error: undefined,
            });
          }),
        },
      ],
      update: {
        actions: assign({
          pending: ({ event }) => event.snapshot,
          desired: ({ event }) => event.snapshot.revision,
        }),
      },
      event: {
        actions: {
          type: "route",
          params: ({ context, event }) => ({
            event: event.event,
            handles: new Map(liveEntries(context.handles)),
          }),
        },
      },
      follow: {
        actions: enqueueActions(({ event, enqueue }) => {
          enqueue.spawnChild("follow", { id: event.id, input: event.stream });
        }),
      },
      unfollow: { actions: stopChild(({ event }) => event.id) },
      streamFailed: { target: ".error", actions: assign({ error: ({ event }) => event.error }) },
      handleCreated: {
        actions: [
          stopChild(({ event }) => creatorId(event.id)),
          assign(({ context, event }) => ({
            handles: withEntry(context.handles, event.id, (entry) => ({
              status: "live",
              source: entry.source,
              handle: event.handle,
              current: event.source,
            })),
            // Re-render so the medium swaps the placeholder for the handle.
            pending: context.pending ?? context.snapshot,
          })),
        ],
      },
      handleFailed: {
        actions: [
          stopChild(({ event }) => creatorId(event.id)),
          assign({ handles: ({ context, event }) => failSources(context.handles, [event]) }),
        ],
      },
      connection: { actions: assign({ connection: ({ event }) => event.connection }) },
      dispose: ".disposed",
    },
    states: {
      idle: {},
      // Transient: the asset stage, if the setup names assets this target keeps.
      starting: {
        always: [
          { guard: ({ context }) => assetCount(context) === 0, target: "ready" },
          { target: "downloading-assets" },
        ],
      },
      "downloading-assets": {
        entry: assign({
          assets: ({ context }) => ({ done: 0, total: assetCount(context), failed: [] }),
        }),
        invoke: { src: "ensureAssets", input: ({ context }) => context.setup ?? missing() },
        on: {
          assetProgress: {
            actions: assign({
              assets: ({ context: { assets = { done: 0, total: 0, failed: [] } }, event }) =>
                event.error === undefined
                  ? { ...assets, done: assets.done + 1 }
                  : { ...assets, failed: [...assets.failed, event.name] },
            }),
          },
          assetsDone: [
            {
              guard: ({ event }) => event.error !== undefined,
              target: "error",
              actions: assign({ error: ({ event }) => event.error }),
            },
            { target: "ready" },
          ],
        },
      },
      ready: {
        initial: "idle",
        states: {
          // Apply whenever something is pending: an update, or a handle that just arrived.
          idle: {
            always: [
              {
                // A revision using a kind the target cannot render fails before anything is
                // touched; the medium keeps the last revision it rendered.
                guard: ({ context }) => unrenderable(context) !== undefined,
                actions: assign(({ context }) => ({
                  pending: undefined,
                  error: unrenderable(context),
                  failed: context.pending?.revision,
                })),
              },
              {
                guard: ({ context }) => context.pending !== undefined,
                target: "applying",
                actions: enqueueActions(({ context, enqueue }) => {
                  // Diff handles against the pending snapshot: spawn creates, stop abandoned
                  // ones, and hand the rest to `apply` as its plan.
                  const snapshot = context.pending;
                  if (snapshot === undefined || context.setup === undefined) return;
                  const diff = diffHandles(context.handles, snapshot.sources);
                  for (const source of diff.create) {
                    enqueue.spawnChild("createHandle", {
                      id: creatorId(source.id),
                      input: { source, setup: context.setup },
                    });
                  }
                  for (const id of diff.abandon) enqueue.stopChild(creatorId(id));
                  enqueue.assign({
                    handles: diff.handles,
                    snapshot,
                    pending: undefined,
                    plan: {
                      snapshot,
                      disposals: diff.disposals,
                      updates: diff.updates,
                      handles: new Map(liveEntries(diff.handles)),
                    },
                  });
                }),
              },
            ],
          },
          applying: {
            invoke: {
              src: "apply",
              input: ({ context }) => context.plan ?? missing(),
              onDone: {
                target: "idle",
                actions: assign(({ context, event }) => {
                  // Failed handle updates become source errors; the revision settles or fails.
                  const revision = context.plan?.snapshot.revision ?? 0;
                  const { error, failed } = event.output;
                  const handles = failSources(context.handles, failed);
                  if (error !== undefined) {
                    return { handles, plan: undefined, error, failed: revision };
                  }
                  const settled = Math.max(context.settled ?? revision, revision);
                  // Re-rendering an older revision (a handle arrived after a newer one was
                  // refused for a missing plugin) leaves that failure standing.
                  return revision < (context.failed ?? 0)
                    ? { handles, plan: undefined, settled }
                    : { handles, plan: undefined, settled, error: undefined, failed: undefined };
                }),
              },
            },
          },
        },
      },
      error: {},
      disposed: { type: "final" },
    },
  });
}

/** Reads a stream until it ends or the actor is stopped, sending each message to the kernel. */
const followStream = fromCallback<EventObject, AsyncIterable<StreamMessage>>(
  ({ input, sendBack }) => {
    const iterator = input[Symbol.asyncIterator]();
    let stopped = false;
    void (async () => {
      try {
        for (let next = await iterator.next(); !stopped && next.done !== true;) {
          sendBack(messageEvent(next.value));
          next = await iterator.next();
        }
      } catch (cause) {
        sendBack({ type: "streamFailed", error: asError(cause) });
      }
    })();
    return () => {
      stopped = true;
      iterator.return?.().catch(() => undefined);
    };
  },
);

export function messageEvent(message: StreamMessage): SetupEvent | UpdateEvent | ShowEventEvent {
  switch (message.kind) {
    case "setup":
      return { type: "setup", setup: message };
    case "update":
      return { type: "update", snapshot: message.snapshot };
    case "event":
      return { type: "event", event: message.event };
  }
}

/** The result of comparing the handle map with a snapshot's sources. */
interface HandleDiff<Handle> {
  readonly handles: ReadonlyMap<string, HandleEntry<Handle>>;
  /** Sources to create: new IDs, and failed IDs whose source changed. */
  readonly create: readonly Source[];
  /** IDs whose `create` is pending but which the snapshot no longer has. */
  readonly abandon: readonly string[];
  readonly disposals: readonly Handle[];
  readonly updates: readonly HandleUpdate<Handle>[];
}

/**
 * Diffs handles by source ID: a new ID, or a failed one whose source changed, is created; a live
 * handle whose source changed is updated; an ID that is gone is disposed or its create abandoned.
 */
function diffHandles<Handle>(
  previous: ReadonlyMap<string, HandleEntry<Handle>>,
  sources: readonly Source[],
): HandleDiff<Handle> {
  const handles = new Map<string, HandleEntry<Handle>>();
  const create: Source[] = [];
  const updates: HandleUpdate<Handle>[] = [];
  for (const source of sources) {
    // Create, update, or carry the entry over with its latest source.
    const entry = previous.get(source.id);
    if (entry === undefined || (entry.status === "error" && !sameSource(entry.source, source))) {
      create.push(source);
      handles.set(source.id, { status: "preparing", source });
    } else if (entry.handle !== undefined && !sameSource(entry.current ?? source, source)) {
      updates.push({ id: source.id, handle: entry.handle, source });
      handles.set(source.id, { ...entry, source, current: source });
    } else {
      handles.set(source.id, { ...entry, source });
    }
  }
  const gone = [...previous].filter(([id]) => !handles.has(id));
  return {
    handles,
    create,
    updates,
    abandon: gone.flatMap(([id, entry]) => (entry.status === "preparing" ? [id] : [])),
    disposals: liveHandles(new Map(gone)),
  };
}

/** Sources are plain JSON with schema-ordered keys, so serialised equality is structural. */
function sameSource(left: Source, right: Source): boolean {
  return (
    left === right ||
    (left.kind === right.kind &&
      JSON.stringify(left.props) === JSON.stringify(right.props) &&
      left.size.width === right.size.width &&
      left.size.height === right.size.height)
  );
}

/** Replaces the entry of a source still in the map; a removed ID is left alone. */
function withEntry<Handle>(
  handles: ReadonlyMap<string, HandleEntry<Handle>>,
  id: string,
  next: (entry: HandleEntry<Handle>) => HandleEntry<Handle>,
): ReadonlyMap<string, HandleEntry<Handle>> {
  const entry = handles.get(id);
  if (entry === undefined) return handles;
  return new Map(handles).set(id, next(entry));
}

/**
 * Whether two setups describe the same stream: show, canvas, assets and serve locations.
 * Setups are plain decoded data, so their JSON forms compare field by field.
 */
function sameSetup(current: SetupMessage | undefined, next: SetupMessage): boolean {
  return current !== undefined && JSON.stringify(current) === JSON.stringify(next);
}

/** Marks sources `error` with their errors, dropping their handles. */
function failSources<Handle>(
  handles: ReadonlyMap<string, HandleEntry<Handle>>,
  failures: readonly SourceFailure[],
): ReadonlyMap<string, HandleEntry<Handle>> {
  return failures.reduce(
    (next, { id, error }) =>
      withEntry(next, id, ({ source }) => ({ status: "error", error, source })),
    handles,
  );
}

/** `[id, handle]` for every live source. */
export function liveEntries<Handle>(
  handles: ReadonlyMap<string, HandleEntry<Handle>>,
): [string, Handle][] {
  return [...handles].flatMap(([id, entry]) =>
    entry.status === "live" && entry.handle !== undefined ? [[id, entry.handle]] : [],
  );
}

function liveHandles<Handle>(handles: ReadonlyMap<string, HandleEntry<Handle>>): Handle[] {
  return liveEntries(handles).map(([, handle]) => handle);
}

/** Why the pending snapshot cannot be rendered: kinds it uses that no plugin renders. */
function unrenderable<Handle>(context: KernelContext<Handle>): Error | undefined {
  const { pending, input } = context;
  if (pending === undefined || input.plugins === undefined) return undefined;
  const absent = [...new Set(pending.sources.map((source) => source.kind))]
    .filter((kind) => input.plugins?.has(kind) !== true)
    .sort();
  if (absent.length === 0) return undefined;
  return new Error(absent.map((kind) => `missing source plugin for kind "${kind}"`).join("; "));
}

function assetCount<Handle>(context: KernelContext<Handle>): number {
  return context.input.assets ? (context.setup?.assets.entries.length ?? 0) : 0;
}

function creatorId(sourceId: string): string {
  return `create:${sourceId}`;
}

/** Placeholder for the I/O `createTarget` provides, and for state that is always present. */
function missing(): never {
  throw new Error("The kernel machine ran without its setup, plan or I/O.");
}

export function asError(cause: unknown, message = "The target failed."): Error {
  return cause instanceof Error ? cause : new Error(message, { cause });
}
