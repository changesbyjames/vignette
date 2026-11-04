import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  createActor,
  fromCallback,
  fromPromise,
  waitFor,
  type Actor,
  type SnapshotFrom,
} from "xstate";

import type { Item, Source } from "../core/snapshot.js";
import type { StreamMessage } from "../stream/messages.js";
import type { AssetFetcher } from "../target/asset-store.js";
import { createTarget, type Target, type TargetSourcePlugin } from "../target/kernel.js";
import type { TargetConnection } from "../target/status.js";
import { fileAssetStore } from "./asset-store.js";
import { bootstrapObsState } from "./bootstrap.js";
import { defaultObsDirectory } from "./directory.js";
import { ObsPreflightError } from "./errors.js";
import { subscribeToObsEvents } from "./events.js";
import { executeObsPlan, type ObsPlacementRunner } from "./executor.js";
import { obsMachine, type ObsDesired, type ObsMachineContext, type ObsOutcome } from "./machine.js";
import {
  layerResourceName,
  managedSceneName,
  managedSourceName,
  registrySceneName,
} from "./naming.js";
import { placementKey, toObsTransform } from "./planner.js";
import type {
  ObsHandle,
  ObsLayerPlugin,
  ObsPlacementContext,
  ObsPluginContext,
  ObsSourcePlugin,
} from "./plugin.js";
import { freePort } from "./port.js";
import { browserObs } from "./sources/browser.js";
import { colorObs } from "./sources/color.js";
import { frameObs } from "./sources/frame.js";
import { imageObs } from "./sources/image.js";
import { textObs } from "./sources/text.js";
import { videoObs } from "./sources/video.js";
import type { ObsTransport } from "./transport.js";
import { ObsWebSocketTransport } from "./websocket-transport.js";

/** A local override for where assets come from. */
export interface ObsAssetOptions {
  /** Downloads one asset; defaults to `serve.assets` + name from the stream's setup. */
  readonly fetch?: AssetFetcher;
}

/** Backoff for reconnects and "not ready" retries. */
export interface ObsRetryOptions {
  /** First delay; doubles per attempt. Default 250 ms. */
  readonly initialDelayMs?: number;
  /** Largest delay. Default 10 s. */
  readonly maximumDelayMs?: number;
  /** Each delay is randomised by up to this fraction either way. Default 0.2. */
  readonly jitterRatio?: number;
  /** "Not ready" answers retried before reconnecting. Default 5. */
  readonly maximumNotReadyAttempts?: number;
}

/** Timers and randomness, injectable so tests control time. */
export interface ObsClock {
  /** Runs `callback` after `delayMs`; returns a function that cancels it. */
  schedule(delayMs: number, callback: () => void): () => void;
  /** A number in `[0, 1)`, for backoff jitter. */
  random(): number;
}

/** Options of {@link obsTarget}. Locations come from the stream; these only override them. */
export interface ObsTargetOptions {
  /** obs-websocket URL. Default `ws://127.0.0.1:4455`. */
  readonly url?: string;
  readonly password?: string;
  readonly assets?: ObsAssetOptions;
  /**
   * Keeps the files OBS loads: downloaded assets in `assets/`, plugin files such as text pages in
   * `sources/`. They outlive the target, because OBS reloads its saved inputs whenever it starts.
   * Default `vignette/obs` in the user's cache directory.
   */
  readonly dir?: string;
  /** The page URL of a frame source; defaults to `serve.frames` and `serve.stream` from setup. */
  readonly frames?: (frame: string, sourceId: string) => string;
  /** Plugins for source kinds; later entries win per kind, including over the built-ins. */
  readonly sources?: readonly ObsSourcePlugin[];
  /** Plugins for layer kinds; a plain `<Layer>` needs none. Later entries win per kind. */
  readonly layers?: readonly ObsLayerPlugin[];
  /** Registers the built-in color, image, video, browser, frame and text plugins. Default `true`. */
  readonly builtins?: boolean;
  /** Backoff for reconnects and "not ready" retries. */
  readonly retry?: ObsRetryOptions;
  /** How requests reach OBS; defaults to obs-websocket. Tests pass a fake. */
  readonly transport?: ObsTransport;
  /** Timers and jitter; defaults to real timers. Tests pass a manual clock. */
  readonly clock?: ObsClock;
}

/** The built-in OBS plugins, registered unless `builtins: false`. */
const BUILTIN_PLUGINS: readonly ObsSourcePlugin[] = [
  colorObs,
  imageObs,
  textObs,
  videoObs,
  browserObs,
  frameObs,
];

/** Real timers and `Math.random`. */
const SYSTEM_CLOCK: ObsClock = {
  schedule(delayMs, callback) {
    const timer = setTimeout(callback, delayMs);
    return () => {
      clearTimeout(timer);
    };
  },
  random: Math.random,
};

/** The running OBS machine. */
type ObsActor = Actor<typeof obsMachine>;

/**
 * Converges OBS to a stream's snapshots. It connects when the first snapshot is ready to apply,
 * reads the scenes and inputs in `vignette/<show>`, executes a dependency-ordered plan, and
 * re-reads until the plan is empty; `update` resolves then. It never touches anything outside
 * that namespace, refuses a stream for another show, and reports its websocket as
 * `status.connection`.
 */
export function obsTarget(options: ObsTargetOptions = {}): Target {
  const transport = options.transport ?? new ObsWebSocketTransport();
  const clock = options.clock ?? SYSTEM_CLOCK;
  const retry = options.retry ?? {};
  const machine = obsMachine.provide({
    actors: {
      connect: fromPromise(() => {
        const url = options.url ?? "ws://127.0.0.1:4455";
        return transport.connect({ url, password: options.password, rpcVersion: 1 });
      }),
      // A failed disconnect leaves nothing to clean up; the next connect replaces the socket.
      disconnect: fromPromise(() =>
        transport.disconnect().then(
          () => undefined,
          () => undefined,
        ),
      ),
      observe: fromPromise(({ input }) => bootstrapObsState(transport, input)),
      execute: fromPromise(async ({ input, signal }) => {
        await executeObsPlan(transport, input.plan, () => !signal.aborted, placements);
        return input.epoch;
      }),
      events: fromCallback(({ sendBack }) => subscribeToObsEvents(transport, sendBack)),
      timer: fromCallback(({ input, sendBack }) =>
        clock.schedule(backoff(input, retry, clock.random()), () => {
          sendBack({ type: "timer" });
        }),
      ),
    },
  });
  const actor = createActor(machine, {
    input: { maximumNotReady: retry.maximumNotReadyAttempts ?? 5 },
  }).start();
  const plugins = [
    ...(options.builtins === false ? [] : BUILTIN_PLUGINS),
    ...(options.sources ?? []),
  ];
  const reloads = reloadPagesWhenConverged(actor, transport);
  const dir = options.dir ?? defaultObsDirectory();
  const layerPlugins = byKind(options.layers);
  const placed = new Map<string, Item>();
  const abort = new AbortController();
  const placements = createPlacementRunner({
    actor,
    transport,
    layerPlugins,
    placed,
    dir,
    signal: abort.signal,
  });
  const target = createTarget<ObsHandle, ObsPluginContext>({
    kind: "obs",
    sources: plugins.map((plugin) => afterObservation(plugin, actor)),
    layers: [...layerPlugins.values()],
    assets: fileAssetStore(join(dir, "assets")),
    fetchAsset: options.assets?.fetch,
    connection(report) {
      let last: TargetConnection | undefined = undefined;
      const subscription = actor.subscribe((snapshot) => {
        // Report changes only: the kernel compares connections by identity.
        const next = connectionOf(snapshot);
        if (next === undefined || (next.phase === last?.phase && next.error === last.error)) return;
        last = next;
        report(next);
      });
      return () => {
        subscription.unsubscribe();
      };
    },
    context: (base) => ({
      ...base,
      frames: options.frames ?? base.frames,
      get inputKinds() {
        return new Set(actor.getSnapshot().context.observed?.inputKinds);
      },
      port: freePort,
      async sourceFile(sourceId, extension) {
        const { show } = actor.getSnapshot().context;
        if (show === undefined) throw new Error("The target has no show yet.");
        // The input name is unique per show and source; its digest is a safe file name.
        const name = createHash("sha256").update(managedSourceName(show, sourceId)).digest("hex");
        const sources = join(dir, "sources");
        await mkdir(sources, { recursive: true });
        return join(sources, `${name.slice(0, 32)}${extension}`);
      },
      async request(sourceId, requestType, data) {
        const { context } = actor.getSnapshot();
        const connected = actor.getSnapshot().matches({ connection: "connected" });
        if (!connected || context.show === undefined) throw new Error("OBS is not connected.");
        const inputName = managedSourceName(context.show, sourceId);
        return transport.call(requestType, { ...data, inputName });
      },
    }),
    update: (snapshot, handles) =>
      converge(actor, { snapshot, handles, layers: new Set(layerPlugins.keys()), placed }),
    async dispose() {
      abort.abort();
      reloads.stop();
      actor.stop();
      await transport.disconnect().catch(() => undefined);
    },
  });
  // Every setup, including the one a reconnecting stream replays, may follow a server outage.
  const tap = async function* (stream: AsyncIterable<StreamMessage>) {
    for await (const message of stream) {
      if (message.kind === "setup") reloads.request();
      yield message;
    }
  };
  return {
    get status() {
      return target.status;
    },
    follow: (stream) => target.follow(tap(stream)),
    apply(message) {
      if (message.kind === "setup") reloads.request();
      target.apply(message);
    },
    subscribe: (listener) => target.subscribe(listener),
    settled: (revision) => target.settled(revision),
    dispose: () => target.dispose(),
  };
}

/** Page reloads the OBS target asks for: `request` after a setup, `stop` on dispose. */
interface PageReloads {
  request(): void;
  stop(): void;
}

/**
 * Reloads browser pages OBS may be showing stale, once OBS has converged them live:
 *
 * - Frame pages, after OBS connects and after each stream setup. OBS loads a page when it starts,
 *   and a page it loaded while the show's server was down stays an error page: its URL never
 *   changes, so convergence alone never reloads it. Frame pages rebuild themselves from the
 *   stream, so a reload costs a blink, not state.
 * - Text pages, after OBS connects: changes pushed while OBS was unreachable never arrived, and
 *   the page file, which the plugin rewrote, has them.
 */
function reloadPagesWhenConverged(actor: ObsActor, transport: ObsTransport): PageReloads {
  // Each connect and each setup starts a generation; a page is reloaded once per generation of
  // its kind. Connecting also covers the target's start: OBS may have started before the server.
  let connects = 0;
  let setups = 0;
  const generations = new Map<string, () => string>([
    ["frame", () => `${String(connects)}.${String(setups)}`],
    ["text", () => String(connects)],
  ]);
  const reloaded = new Map<string, string>();
  let connected = false;
  let seen: ObsOutcome | undefined = undefined;
  const subscription = actor.subscribe((snapshot) => {
    const nowConnected = snapshot.matches({ connection: "connected" });
    if (nowConnected && !connected) connects += 1;
    connected = nowConnected;
    const { outcome, show } = snapshot.context;
    const fresh = outcome !== seen;
    seen = outcome;
    // Only a newly settled convergence, while connected, places pages worth reloading.
    if (!fresh || !connected || show === undefined || outcome?.error !== undefined) return;
    if (outcome !== undefined) reloadPages(outcome.desired, show);
  });
  /**
   * Presses refresh on each live page not yet reloaded in its kind's generation; failures are
   * moot, because the next generation tries again.
   */
  function reloadPages({ snapshot, handles }: ObsDesired, show: string): void {
    for (const source of snapshot.sources) {
      // Skips kinds without pages, sources not live yet, and pages reloaded in this generation.
      const generation = generations.get(source.kind)?.();
      if (generation === undefined || !handles.has(source.id)) continue;
      if (reloaded.get(source.id) === generation) continue;
      reloaded.set(source.id, generation);
      const inputName = managedSourceName(show, source.id);
      transport
        .call("PressInputPropertiesButton", { inputName, propertyName: "refreshnocache" })
        .catch(() => undefined);
    }
  }
  return {
    request() {
      setups += 1;
    },
    stop() {
      subscription.unsubscribe();
    },
  };
}

/**
 * Hands `snapshot` to the machine and resolves when convergence settles for it; rejects when its
 * plan fails, OBS invalidates the session, or the target is disposed. A snapshot for another
 * show is refused before the machine sees it.
 */
async function converge(actor: ObsActor, desired: ObsDesired): Promise<void> {
  const { snapshot } = desired;
  const { show } = actor.getSnapshot().context;
  if (show !== undefined && snapshot.id !== show) {
    throw new ObsPreflightError(
      `The stream is for show '${snapshot.id}', but this OBS target manages '${show}'; refusing to touch OBS.`,
    );
  }
  actor.send({ type: "apply", ...desired });
  const applied = actor.getSnapshot().context.desired;
  const { outcome } = await unlessTerminal(
    actor,
    (context) => context.outcome?.desired === applied,
  );
  if (outcome?.error !== undefined) throw outcome.error;
}

/** Resolves once `ready` holds; rejects if OBS invalidates the session or the target stops first. */
async function unlessTerminal(
  actor: ObsActor,
  ready: (context: ObsMachineContext) => boolean,
): Promise<ObsMachineContext> {
  const { context } = await waitFor(
    actor,
    (state) => ready(state.context) || state.matches({ connection: "terminal" }),
  );
  if (!ready(context)) throw context.error ?? new Error("OBS invalidated the session.");
  return context;
}

/** The `connection` region as the kernel's connection report; nothing before the first connect. */
function connectionOf(snapshot: SnapshotFrom<typeof obsMachine>): TargetConnection | undefined {
  const { error } = snapshot.context;
  if (snapshot.matches({ connection: "connecting" })) return { phase: "connecting" };
  if (snapshot.matches({ connection: "connected" })) return { phase: "open" };
  if (snapshot.matches({ connection: "retry-wait" })) return { phase: "retry-wait", error };
  if (snapshot.matches({ connection: "terminal" })) return { phase: "closed", error };
  return undefined;
}

/**
 * Runs a plugin's `create` once OBS has been observed, so `inputKinds` is known. A handle without
 * `update` is re-created when its props change, so a plugin that only maps props to an input
 * needs nothing else.
 */
function afterObservation(
  plugin: ObsSourcePlugin,
  actor: ObsActor,
): TargetSourcePlugin<ObsHandle, ObsPluginContext> {
  return {
    ...plugin,
    async create(source, context) {
      await unlessTerminal(actor, (state) => state.observed !== undefined);
      const handle = await createSupported(plugin, source, context);
      return handle.update === undefined ? recreating(plugin, handle, context) : handle;
    },
  };
}

/**
 * Creates a handle whose input kind OBS has. An input kind OBS lacks fails this source, not the
 * show: the planner skips a source without a handle, so the rest of the show still converges.
 */
async function createSupported(
  plugin: ObsSourcePlugin,
  source: Source,
  context: ObsPluginContext,
): Promise<ObsHandle> {
  const handle = await plugin.create(source, context);
  const { kind } = handle.input;
  if (context.inputKinds.has(kind)) return handle;
  await handle.dispose?.();
  throw new Error(`OBS has no input kind '${kind}' for source '${source.id}'.`);
}

/** A handle that answers `update` by creating its replacement and disposing itself. */
function recreating(
  plugin: ObsSourcePlugin,
  first: ObsHandle,
  context: ObsPluginContext,
): ObsHandle {
  let current = first;
  return {
    get input() {
      return current.input;
    },
    async update(source: Source) {
      const previous = current;
      current = await createSupported(plugin, source, context);
      await previous.dispose?.();
    },
    async dispose() {
      await current.dispose?.();
    },
    async event(event) {
      await current.event?.(event);
    },
  };
}

/** Capped exponential backoff for `attempt`, randomised by the jitter ratio. */
function backoff(attempt: number, retry: ObsRetryOptions, random: number): number {
  const initial = Math.max(1, retry.initialDelayMs ?? 250);
  const maximum = Math.max(initial, retry.maximumDelayMs ?? 10_000);
  const jitter = Math.min(1, Math.max(0, retry.jitterRatio ?? 0.2));
  const base = Math.min(maximum, initial * 2 ** attempt);
  return Math.max(0, Math.round(base * (1 + (random * 2 - 1) * jitter)));
}

/** Layer plugins by kind; later entries win. */
function byKind(plugins: readonly ObsLayerPlugin[] | undefined): Map<string, ObsLayerPlugin> {
  return new Map((plugins ?? []).map((plugin) => [plugin.kind, plugin]));
}

/** What the placement runner works with. */
interface PlacementRunnerOptions {
  readonly actor: ObsActor;
  readonly transport: ObsTransport;
  readonly layerPlugins: ReadonlyMap<string, ObsLayerPlugin>;
  /** The item each handed-over placement was last placed with; shared with the planner. */
  readonly placed: Map<string, Item>;
  readonly dir: string;
  readonly signal: AbortSignal;
}

/** A layer plugin and the context for one placement of an item of its kind. */
interface Placement {
  readonly plugin: ObsLayerPlugin;
  readonly context: ObsPlacementContext;
}

/**
 * Runs `place-item` and `release-placement` through the layer plugin for the item's kind, and
 * records what each placement was last placed with, so the planner hands an item over only when
 * it changed. Each plugin loads once; a failed load is retried by the next placement.
 */
function createPlacementRunner(options: PlacementRunnerOptions): ObsPlacementRunner {
  const { actor, transport, layerPlugins, placed, dir, signal } = options;
  const loads = new Map<string, Promise<void>>();

  // A released item's source may have left the show: it is then found in the last settled
  // snapshot, and its handle is gone. Lookups miss only between snapshots; then nothing is placed.
  function placement(item: Item, sceneId: string, sceneItemId: number): Placement {
    const plugin = layerPlugins.get(item.kind);
    const { desired, outcome, show } = actor.getSnapshot().context;
    const isSource = (candidate: Source) => candidate.id === item.sourceId;
    const source =
      desired?.snapshot.sources.find(isSource) ?? outcome?.desired.snapshot.sources.find(isSource);
    const handle = desired?.handles.get(item.sourceId);
    if (
      plugin === undefined ||
      desired === undefined ||
      show === undefined ||
      source === undefined
    ) {
      throw new Error(`Layer '${item.id}' of kind '${item.kind}' cannot be placed.`);
    }
    const context: ObsPlacementContext = {
      canvas: desired.snapshot.canvas,
      signal,
      sceneId,
      sceneName: managedSceneName(show, sceneId),
      sceneItemId,
      source,
      handle,
      transform: toObsTransform(item, source.size),
      registryScene: registrySceneName(show),
      resourceName: (name) => layerResourceName(show, plugin.kind, name),
      call: (requestType, requestData) => transport.call(requestType, requestData),
      async directory() {
        const path = join(dir, "layers", plugin.kind);
        await mkdir(path, { recursive: true });
        return path;
      },
    };
    return { plugin, context };
  }

  return {
    async place(operation, sceneItemId) {
      const { plugin, context } = placement(operation.item, operation.sceneId, sceneItemId);
      if (plugin.load !== undefined && !loads.has(plugin.kind)) {
        loads.set(plugin.kind, plugin.load());
        loads.get(plugin.kind)?.catch(() => loads.delete(plugin.kind));
      }
      await loads.get(plugin.kind);
      await plugin.place(operation.item, { ...context, previous: operation.previous });
      placed.set(placementKey(operation.sceneId, operation.item.id), operation.item);
    },
    async release(operation) {
      const { plugin, context } = placement(
        operation.item,
        operation.sceneId,
        operation.sceneItemId,
      );
      await plugin.remove(operation.item, context);
      placed.delete(placementKey(operation.sceneId, operation.item.id));
    },
  };
}
