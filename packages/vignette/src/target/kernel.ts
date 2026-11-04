import {
  createActor,
  fromCallback,
  fromPromise,
  waitFor,
  type Actor,
  type SnapshotFrom,
} from "xstate";
import { z } from "zod";

import type { Snapshot, Source } from "../core/snapshot.js";
import type { SetupMessage, ShowEvent, StreamMessage } from "../stream/messages.js";
import { serveFetcher, type AssetFetcher, type AssetStore } from "./asset-store.js";
import {
  asError,
  createKernelMachine,
  liveEntries,
  messageEvent,
  type ApplyOutput,
  type SourceFailure,
  type ApplyPlan,
  type CreateInput,
  type KernelContext,
  type RouteParams,
} from "./kernel-machine.js";
import { frameUrl, type PluginContextBase, type SourcePluginBase } from "./plugins.js";
import type { SourceStatus, TargetConnection, TargetPhase, TargetStatus } from "./status.js";

/**
 * The contract every target has, built in or custom. A target consumes a stream, converges its
 * medium to the latest snapshot, and reports progress and failures through `status`.
 */
export interface Target {
  /** Consumes a stream until it ends or `stop` is called. Errors become status, not rejections. */
  follow(stream: AsyncIterable<StreamMessage>): () => void;
  /** Applies one message by hand. */
  apply(message: StreamMessage): void;
  /** Current status; a new object whenever it changes, for `useSyncExternalStore`. */
  readonly status: TargetStatus;
  /** Calls `listener` after every status change; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Resolves once the target has applied `revision`, or the latest desired revision. */
  settled(revision?: number): Promise<void>;
  /** Stops following, disposes every handle and the asset store. */
  dispose(): Promise<void>;
}

/** Lifetime members a handle may implement; the kernel calls them as the source changes. */
export interface TargetHandle {
  /** The same source ID arrived with changed props or size. */
  update?(source: Source): void | Promise<void>;
  /** The source ID is gone, or the target is disposed. */
  dispose?(): void | Promise<void>;
  /** A show event addressed to this source, or to no source in particular. */
  event?(event: ShowEvent): void | Promise<void>;
}

/** How a target creates a handle for each source of the plugin's kind. */
export interface TargetSourcePlugin<
  Handle extends TargetHandle,
  Context extends PluginContextBase = PluginContextBase,
> extends SourcePluginBase {
  /** Runs once before the plugin's first `create`, e.g. to import a custom element. */
  load?(): Promise<void>;
  /** Creates a handle when a source ID first appears. While it is pending the source is `preparing`. */
  create(source: Source, context: Context): Handle | Promise<Handle>;
}

/** What a target supplies to `createTarget`; the kernel provides everything else. */
export interface CreateTargetOptions<
  Handle extends TargetHandle = TargetHandle,
  Context extends PluginContextBase = PluginContextBase,
> {
  /** Names the target in status messages, e.g. `"dom"` or `"obs"`. */
  readonly kind: string;
  /**
   * Plugins for the source kinds this target renders; later entries win per kind. A target
   * without a notion of sources omits it and receives an empty handle map.
   */
  readonly sources?: readonly TargetSourcePlugin<Handle, Context>[];
  /** Where downloaded assets are kept. Omit for targets that do not resolve assets. */
  readonly assets?: AssetStore;
  /** Overrides how asset bytes are fetched; defaults to `serve.assets` + name. */
  readonly fetchAsset?: AssetFetcher;
  /**
   * Fail a setup whose kinds lack a plugin, before any asset or handle. Default `true`. When
   * `false`, a source whose kind has no plugin is `error` and the rest of the scene renders.
   */
  readonly checkPlugins?: boolean;
  /**
   * For media with a connection (OBS's websocket, a page's SSE): called once at creation with a
   * `report` function the medium calls on every change; the result shows as `status.connection`.
   * Returns a function that stops reporting, called on dispose.
   */
  connection?(report: (connection: TargetConnection) => void): () => void;
  /** Extends the base plugin context with medium-specific members. */
  context?(base: PluginContextBase): Context;
  /**
   * Renders one snapshot into the medium. `handles` holds every live handle by source ID; a
   * source still `preparing` is absent, so the medium renders a placeholder until it arrives.
   * The kernel alone decides when a revision is settled: when the returned promise resolves
   * (or at once for `void`). A rejection is a failed apply of that revision. Snapshots are
   * applied one at a time; later updates wait, and only the latest is applied next.
   */
  update(snapshot: Snapshot, handles: ReadonlyMap<string, Handle>): void | Promise<void>;
  /** Handles a show event at target level, after handles with an `event` member saw it. */
  event?(event: ShowEvent, handles: ReadonlyMap<string, Handle>): void | Promise<void>;
  /** Releases the medium when the target is disposed. */
  dispose?(): void | Promise<void>;
}

/**
 * Creates a target from a medium: setup checks, the asset stage, the plugin lifetime, status,
 * settlement and `follow`/`apply`/`dispose` are provided by the kernel machine in
 * `kernel-machine.ts`; this function supplies its I/O and exposes it as a {@link Target}.
 */
export function createTarget<
  Handle extends TargetHandle = TargetHandle,
  Context extends PluginContextBase = PluginContextBase,
>(options: CreateTargetOptions<Handle, Context>): Target {
  const abort = new AbortController();
  const plugins = new Map((options.sources ?? []).map((plugin) => [plugin.kind, plugin]));
  const loads = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  let follows = 0;

  async function create({ source, setup }: CreateInput): Promise<Handle> {
    const plugin = plugins.get(source.kind);
    if (plugin === undefined) throw new Error(`no plugin for kind "${source.kind}"`);
    // Each plugin loads once; a failed load is retried by the next create.
    if (plugin.load !== undefined && !loads.has(plugin.kind)) {
      loads.set(plugin.kind, plugin.load());
      loads.get(plugin.kind)?.catch(() => loads.delete(plugin.kind));
    }
    await loads.get(plugin.kind);
    return plugin.create(source, pluginContext(setup));
  }

  function pluginContext(setup: SetupMessage): Context {
    const base: PluginContextBase = {
      canvas: setup.canvas,
      signal: abort.signal,
      assets: {
        resolve: (name) =>
          new Promise((resolve) => {
            if (options.assets === undefined)
              throw new Error(`This target keeps no assets: "${name}".`);
            resolve(options.assets.resolve(name));
          }),
      },
      frames: (frame, sourceId) => frameUrl(setup, frame, sourceId),
    };
    // SAFETY: Without a `context` extension the target's Context is the base context.
    return options.context?.(base) ?? (base as Context);
  }

  /** Disposes gone handles, updates changed ones, then renders; never rejects. */
  async function apply(plan: ApplyPlan<Handle>): Promise<ApplyOutput> {
    await Promise.all(plan.disposals.map(disposeHandle));
    const handles = new Map(plan.handles);
    const failed: SourceFailure[] = [];
    for (const { id, handle, source } of plan.updates) {
      try {
        await handle.update?.(source);
      } catch (cause) {
        failed.push({ id, error: asError(cause, `Source '${id}' failed to update.`) });
        handles.delete(id);
        await disposeHandle(handle);
      }
    }
    try {
      await options.update(plan.snapshot, handles);
      return { failed };
    } catch (cause) {
      return {
        failed,
        error: asError(cause, `Revision ${String(plan.snapshot.revision)} failed.`),
      };
    }
  }

  const machine = createKernelMachine<Handle>().provide({
    actors: {
      checkPlugins: fromPromise(({ input }) => {
        const absent =
          options.checkPlugins === false ? [] : input.filter((kind) => !plugins.has(kind));
        const messages = absent.map((kind) => `missing source plugin for kind "${kind}"`);
        return absent.length === 0
          ? Promise.resolve(undefined)
          : Promise.reject(new Error(messages.join("; ")));
      }),
      ensureAssets: fromCallback(({ input, sendBack }) => {
        const stage = new AbortController();
        const fetchAsset = options.fetchAsset ?? serveFetcher(input);
        options.assets
          ?.ensure(
            input.assets.entries,
            (entry, signal) => fetchAsset(entry, AbortSignal.any([stage.signal, signal])),
            (name, error) => {
              sendBack({ type: "assetProgress", name, error });
            },
          )
          .then(
            () => {
              sendBack({ type: "assetsDone" });
            },
            (cause: unknown) => {
              sendBack({ type: "assetsDone", error: asError(cause, "The asset stage failed.") });
            },
          );
        return () => {
          stage.abort();
        };
      }),
      createHandle: fromCallback(({ input, sendBack }) => {
        // A handle that resolves after this actor was stopped has no source any more.
        let stopped = false;
        create(input).then(
          async (handle) => {
            if (stopped) await disposeHandle(handle);
            else
              sendBack({
                type: "handleCreated",
                id: input.source.id,
                handle,
                source: input.source,
              });
          },
          (cause: unknown) => {
            const error = asError(cause, `Source "${input.source.id}" failed to create.`);
            sendBack({ type: "handleFailed", id: input.source.id, error });
          },
        );
        return () => {
          stopped = true;
        };
      }),
      apply: fromPromise(({ input }) => apply(input)),
      connection: fromCallback(({ sendBack }) =>
        options.connection?.((connection) => {
          sendBack({ type: "connection", connection });
        }),
      ),
    },
    actions: {
      disposeHandles: (_, handles) => {
        for (const handle of handles) void disposeHandle(handle);
      },
      evictAssets: (_, keep) => {
        options.assets?.evict(keep).catch(() => undefined);
      },
      route: (_, params) => {
        void routeEvent(params, options);
      },
    },
  });
  const actor = createActor(machine, {
    input: { assets: options.assets !== undefined },
  });
  let status = statusOf(actor.getSnapshot());
  actor.subscribe((snapshot) => {
    const next = statusOf(snapshot);
    if (sameStatus(status, next)) return;
    status = next;
    for (const listener of [...listeners]) listener();
  });
  actor.start();
  const live = () => actor.getSnapshot().status === "active";

  return {
    follow(stream) {
      const id = `follow:${String(follows++)}`;
      if (live()) actor.send({ type: "follow", id, stream });
      return () => {
        if (live()) actor.send({ type: "unfollow", id });
      };
    },
    apply(message) {
      if (live()) actor.send(messageEvent(message));
    },
    get status() {
      return status;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    settled: (revision) => settledPromise(actor, revision),
    async dispose() {
      if (!live()) return;
      const handles = liveEntries(actor.getSnapshot().context.handles);
      // Final: stops follows, the asset stage, pending creates (which dispose late handles) and
      // an apply in flight, whose result nobody waits for any more.
      actor.send({ type: "dispose" });
      abort.abort();
      await Promise.all(handles.map(([, handle]) => disposeHandle(handle)));
      await settle(() => options.assets?.dispose());
      await settle(() => options.dispose?.());
    },
  };
}

/** The kernel machine for one handle type. */
type KernelMachine<Handle extends TargetHandle> = ReturnType<typeof createKernelMachine<Handle>>;
/** A state of the kernel machine. */
type KernelSnapshot<Handle extends TargetHandle> = SnapshotFrom<KernelMachine<Handle>>;

/** Resolves once `revision` (default: the latest desired) is settled; rejects on failure. */
async function settledPromise<Handle extends TargetHandle>(
  actor: Actor<KernelMachine<Handle>>,
  revision?: number,
): Promise<void> {
  const wanted = revision ?? actor.getSnapshot().context.desired ?? 0;
  const outcome = settlement(
    await waitFor(actor, (snapshot) => settlement(snapshot, wanted) !== "pending"),
    wanted,
  );
  if (outcome instanceof Error) throw outcome;
}

/** Whether a waiter for `wanted` is settled, failed (the error), or still pending. */
function settlement<Handle extends TargetHandle>(
  snapshot: KernelSnapshot<Handle>,
  wanted: number,
): "settled" | "pending" | Error {
  const { settled, failed, error } = snapshot.context;
  if (settled !== undefined && settled >= wanted) return "settled";
  if (snapshot.status !== "active") return new Error("The target was disposed.");
  if (snapshot.matches("error")) return error ?? new Error("The target failed.");
  return failed !== undefined && failed >= wanted && error !== undefined ? error : "pending";
}

const PHASES = ["idle", "checking-plugins", "downloading-assets", "error", "disposed"] as const;

function statusOf<Handle extends TargetHandle>(snapshot: KernelSnapshot<Handle>): TargetStatus {
  const { context } = snapshot;
  const sources: Record<string, SourceStatus> = {};
  const sourceErrors: Record<string, Error> = {};
  for (const [id, entry] of context.handles) {
    sources[id] = entry.status;
    if (entry.error !== undefined) sourceErrors[id] = entry.error;
  }
  return {
    phase: phaseOf(snapshot, context),
    revision: { desired: context.desired, settled: context.settled },
    assets: context.assets,
    sources,
    sourceErrors,
    error: context.error,
    connection: context.connection,
  };
}

/** `ready` splits into `synchronising`, `settled` and, after a failed apply, `error`. */
function phaseOf<Handle extends TargetHandle>(
  snapshot: KernelSnapshot<Handle>,
  context: KernelContext<Handle>,
): TargetPhase {
  const named = PHASES.find((phase) => snapshot.matches(phase));
  if (named !== undefined) return named;
  if (snapshot.matches({ ready: "applying" })) return "synchronising";
  if (context.error !== undefined) return "error";
  const converged = context.settled !== undefined && context.settled === context.desired;
  return converged ? "settled" : "synchronising";
}

/** Field-wise equality, so `status` keeps its identity until something observable changes. */
function sameStatus(left: TargetStatus, right: TargetStatus): boolean {
  return (
    left.phase === right.phase &&
    left.revision.desired === right.revision.desired &&
    left.revision.settled === right.revision.settled &&
    left.assets === right.assets &&
    left.error === right.error &&
    left.connection === right.connection &&
    JSON.stringify(left.sources) === JSON.stringify(right.sources)
  );
}

/** Handles see an event addressed to their source, or every event without a `sourceId`. */
async function routeEvent<Handle extends TargetHandle, Context extends PluginContextBase>(
  { event, handles }: RouteParams<Handle>,
  options: CreateTargetOptions<Handle, Context>,
): Promise<void> {
  const { sourceId }: AddressedEvent = AddressedEventSchema.parse(event);
  const addressed = sourceId === undefined ? [...handles.values()] : [handles.get(sourceId)];
  for (const handle of addressed) await settle(() => handle?.event?.(event));
  await settle(() => options.event?.(event, handles));
}

/** The optional source address of a show event. */
const AddressedEventSchema = z.looseObject({ sourceId: z.string().optional() });
/** The optional source address of a show event. */
type AddressedEvent = z.output<typeof AddressedEventSchema>;

async function disposeHandle(handle: TargetHandle): Promise<void> {
  await settle(() => handle.dispose?.());
}

/** Runs a lifecycle callback and swallows its failure; failures there are not status. */
async function settle(task: () => void | Promise<void>): Promise<void> {
  try {
    await task();
  } catch {
    // A handle's dispose or a target's event hook failing must not stop the kernel.
  }
}
