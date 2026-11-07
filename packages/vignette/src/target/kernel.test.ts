import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { AssetEntry } from "../core/assets.js";
import type { Snapshot, Source } from "../core/snapshot.js";
import { createAsyncQueue } from "../stream/async-queue.js";
import type { SetupMessage, ShowEvent, StreamMessage } from "../stream/messages.js";
import { createAssetStore, type AssetStore } from "./asset-store.js";
import { createTarget, type TargetHandle, type TargetSourcePlugin } from "./kernel.js";
import type { TargetConnection } from "./status.js";

const logoBytes = new TextEncoder().encode("logo bytes");
const logo: AssetEntry = {
  name: "logo.png",
  hash: `sha256-${createHash("sha256").update(logoBytes).digest("base64")}`,
};

function setup(entries: readonly AssetEntry[] = []): SetupMessage {
  return {
    kind: "setup",
    id: "show",
    canvas: { width: 1920, height: 1080 },
    assets: { version: "v1", entries },
    serve: { assets: "https://show.example/assets/" },
  };
}

function source(id: string, asset?: string): Source {
  return {
    id,
    kind: "test",
    props: asset === undefined ? {} : { src: asset },
    size: { width: 10, height: 10 },
  };
}

function update(revision: number, sources: readonly Source[]): StreamMessage {
  return {
    kind: "update",
    snapshot: {
      revision,
      id: "show",
      canvas: { width: 1920, height: 1080 },
      sources,
      scenes: [{ id: "main", items: [] }],
    },
  };
}

/** An in-memory store and the locations it released. */
interface MemoryStore {
  readonly store: AssetStore;
  readonly released: string[];
}

/** An asset store keeping bytes in memory, built on the shared bookkeeping. */
function memoryStore(): MemoryStore {
  const released: string[] = [];
  const store = createAssetStore<string>({
    store: (entry) => `memory:${entry.name}`,
    release: (location) => {
      released.push(location);
    },
  });
  return { store, released };
}

interface RecordingHandle extends TargetHandle {
  readonly id: string;
  readonly location?: string;
  readonly events: ShowEvent[];
}

/** The test kind's props: an optional asset name. */
const TestPropsSchema = z.object({ src: z.string().optional() });
/** The test kind's props: an optional asset name. */
type TestProps = z.output<typeof TestPropsSchema>;

/** A plugin whose handles record events and resolve their `src` asset on create. */
const recordingPlugin: TargetSourcePlugin<RecordingHandle> = {
  kind: "test",
  async create(created, context) {
    const { src }: TestProps = TestPropsSchema.parse(created.props);
    const location = src === undefined ? undefined : await context.assets.resolve(src);
    const events: ShowEvent[] = [];
    return {
      id: created.id,
      location,
      events,
      event(event) {
        events.push(event);
      },
    };
  },
};

/** A promise resolved from outside, for controlling timing. */
interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

/** A deferred promise for controlling fetch timing. */
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** What the medium saw in one render. */
interface AppliedRender {
  readonly revision: number;
  readonly locations: (string | undefined)[];
}

describe("createTarget", () => {
  it("downloads and verifies assets before the first update reaches the medium", async () => {
    const log: string[] = [];
    const download = deferred<Uint8Array>();
    const { store } = memoryStore();
    const applied: AppliedRender[] = [];
    const target = createTarget<RecordingHandle>({
      kind: "test",
      sources: [recordingPlugin],
      assets: store,
      fetchAsset: (entry) => {
        log.push(`fetch ${entry.name}`);
        return download.promise;
      },
      update(snapshot: Snapshot, handles) {
        log.push(`update ${String(snapshot.revision)}`);
        applied.push({
          revision: snapshot.revision,
          locations: [...handles.values()].map((handle) => handle.location),
        });
      },
    });

    target.apply(setup([logo]));
    target.apply(update(1, [source("a", "logo.png")]));
    await waitFor(() => log.length > 0);
    expect(target.status.phase).toBe("downloading-assets");
    expect(log).toEqual(["fetch logo.png"]);

    download.resolve(logoBytes);
    await target.settled(1);
    await waitFor(() => target.status.sources.a === "live" && target.status.phase === "settled");

    expect(log.slice(0, 2)).toEqual(["fetch logo.png", "update 1"]);
    expect(applied.at(-1)).toEqual({ revision: 1, locations: ["memory:logo.png"] });
    expect(target.status.assets).toEqual({ done: 1, total: 1, failed: [] });
    await target.dispose();
  });

  it("fails the asset stage on a hash mismatch and never renders", async () => {
    const updates: number[] = [];
    const target = createTarget<RecordingHandle>({
      kind: "test",
      sources: [recordingPlugin],
      assets: memoryStore().store,
      fetchAsset: () => Promise.resolve(new TextEncoder().encode("tampered")),
      update(snapshot) {
        updates.push(snapshot.revision);
      },
    });
    target.apply(setup([logo]));
    target.apply(update(1, []));
    const settled = target.settled(1);

    await expect(settled).rejects.toThrow(/failed verification/u);
    expect(target.status).toMatchObject({
      phase: "error",
      assets: { done: 0, total: 1, failed: ["logo.png"] },
    });
    expect(updates).toEqual([]);
    await target.dispose();
  });

  it("fails the asset stage when assets are listed but serve.assets is absent", async () => {
    const target = createTarget({
      kind: "test",
      assets: memoryStore().store,
      update: () => undefined,
    });
    target.apply({ ...setup([logo]), serve: {} });
    await expect(target.settled()).rejects.toThrow(/MISSING_SERVE/u);
    expect(target.status).toMatchObject({ phase: "error", assets: { failed: ["logo.png"] } });
    await target.dispose();
  });

  it("fails a revision using a kind without a plugin before creating or rendering it", async () => {
    const rendered: number[] = [];
    const target = createTarget<RecordingHandle>({
      kind: "test",
      sources: [recordingPlugin],
      update(snapshot) {
        rendered.push(snapshot.revision);
      },
    });
    target.apply(setup());
    target.apply(update(1, [source("a"), { ...source("m"), kind: "moq" }]));
    await expect(target.settled(1)).rejects.toThrow('missing source plugin for kind "moq"');
    expect(target.status).toMatchObject({ phase: "error", sources: {} });
    expect(rendered).toEqual([]);

    // The same stream carries on: a revision the target can render clears the error.
    target.apply(update(2, [source("a")]));
    await waitFor(() => target.status.phase === "settled" && target.status.sources.a === "live");
    expect(target.status.error).toBeUndefined();
    await target.dispose();
  });

  it("routes events to the addressed handle, or to every handle and the target", async () => {
    const targetEvents: string[] = [];
    let handles: ReadonlyMap<string, RecordingHandle> = new Map();
    const target = createTarget<RecordingHandle>({
      kind: "test",
      sources: [recordingPlugin],
      update(_snapshot, current) {
        handles = current;
      },
      event(event) {
        targetEvents.push(event.kind);
      },
    });
    target.apply(setup());
    target.apply(update(1, [source("a"), source("b")]));
    await waitFor(() => handles.size === 2);

    target.apply({ kind: "event", event: { kind: "media:restart", sourceId: "a" } });
    target.apply({ kind: "event", event: { kind: "flash" } });
    await waitFor(() => targetEvents.length === 2);

    expect(handles.get("a")?.events.map((event) => event.kind)).toEqual(["media:restart", "flash"]);
    expect(handles.get("b")?.events.map((event) => event.kind)).toEqual(["flash"]);
    expect(targetEvents).toEqual(["media:restart", "flash"]);
    await target.dispose();
  });

  it("follows a stream until stopped and reports stream failure as status", async () => {
    const revisions: number[] = [];
    const target = createTarget({
      kind: "log",
      update(snapshot) {
        revisions.push(snapshot.revision);
      },
    });
    const first = createAsyncQueue<StreamMessage>();
    const stop = target.follow(first);
    first.push(setup([]));
    first.push(update(1, []));
    await target.settled(1);
    expect(target.status).toMatchObject({ phase: "settled", revision: { desired: 1, settled: 1 } });

    stop();
    first.push(update(2, []));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(target.status.revision.desired).toBe(1);

    const second = createAsyncQueue<StreamMessage>();
    target.follow(second);
    second.fail(new Error("connection lost"));
    await waitFor(() => target.status.phase === "error");
    expect(target.status.error?.message).toBe("connection lost");
    expect(revisions).toEqual([1]);
    await target.dispose();
  });

  it("resolves settled(revision) once that revision or a later one is applied", async () => {
    const gate = deferred<undefined>();
    const target = createTarget({
      kind: "slow",
      update: async () => gate.promise,
    });
    target.apply(setup([]));
    target.apply(update(1, []));
    target.apply(update(3, []));
    let settled = false;
    const waiting = target.settled(2).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(target.status.phase).toBe("synchronising");

    gate.resolve(undefined);
    await waiting;
    await target.settled();
    expect(target.status).toMatchObject({ phase: "settled", revision: { desired: 3, settled: 3 } });
    await target.dispose();
    expect(target.status.phase).toBe("disposed");
  });

  it("settles a revision only when the medium's update promise resolves", async () => {
    const gate = deferred<undefined>();
    let fail = true;
    const target = createTarget({
      kind: "converging",
      async update() {
        await gate.promise;
        if (fail) throw new Error("medium refused");
      },
    });
    target.apply(setup([]));
    target.apply(update(1, []));
    const first = target.settled(1);
    await waitFor(() => target.status.phase === "synchronising");

    gate.resolve(undefined);
    await expect(first).rejects.toThrow("medium refused");
    expect(target.status).toMatchObject({ phase: "error", revision: { desired: 1 } });
    expect(target.status.revision.settled).toBeUndefined();

    fail = false;
    target.apply(update(2, []));
    await target.settled(2);
    expect(target.status).toMatchObject({ phase: "settled", revision: { settled: 2 } });
    expect(target.status.error).toBeUndefined();
    await target.dispose();
  });

  it("renders the rest of the scene when checkPlugins is off and a kind has no plugin", async () => {
    let rendered: readonly string[] = [];
    const target = createTarget<RecordingHandle>({
      kind: "frame-page",
      sources: [recordingPlugin],
      checkPlugins: false,
      update(_snapshot, handles) {
        rendered = [...handles.keys()];
      },
    });
    target.apply(setup([]));
    target.apply(update(1, [source("a"), { ...source("m"), kind: "moq" }]));
    await target.settled(1);
    await waitFor(() => rendered.length === 1 && target.status.phase === "settled");

    expect(rendered).toEqual(["a"]);
    expect(target.status).toMatchObject({ phase: "settled", sources: { a: "live", m: "error" } });
    await target.dispose();
  });

  it("reports the medium's connection in status and stops reporting on dispose", async () => {
    let report: (connection: TargetConnection) => void = () => undefined;
    let stopped = false;
    const target = createTarget({
      kind: "connected",
      update: () => undefined,
      connection(next) {
        report = next;
        return () => {
          stopped = true;
        };
      },
    });
    const statuses: (TargetConnection | undefined)[] = [];
    target.subscribe(() => statuses.push(target.status.connection));
    const error = new Error("refused");

    report({ phase: "connecting" });
    report({ phase: "retry-wait", error });
    expect(statuses).toEqual([{ phase: "connecting" }, { phase: "retry-wait", error }]);
    expect(target.status.phase).toBe("idle");

    await target.dispose();
    expect(stopped).toBe(true);
  });

  it("keeps handles when a reconnect replays the same setup, and starts over on a new one", async () => {
    let created = 0;
    let disposed = 0;
    const phases: string[] = [];
    const target = createTarget({
      kind: "test",
      sources: [
        {
          kind: "test",
          create() {
            created += 1;
            return {
              dispose() {
                disposed += 1;
              },
            };
          },
        },
      ],
      update: () => undefined,
    });
    target.subscribe(() => phases.push(target.status.phase));
    target.apply(setup());
    target.apply(update(1, [source("a")]));
    await waitFor(() => target.status.sources.a === "live" && target.status.phase === "settled");
    phases.length = 0;

    // What a reconnect delivers: the same setup, then the latest update again.
    target.apply(setup());
    target.apply(update(1, [source("a")]));
    await target.settled(1);
    expect({ created, disposed }).toEqual({ created: 1, disposed: 0 });
    expect(phases).not.toContain("checking-plugins");

    // A restarted composer replays the same setup but counts revisions from 1 again.
    target.apply(update(5, [source("a")]));
    await target.settled(5);
    target.apply(setup());
    target.apply(update(1, [source("a")]));
    await waitFor(() => target.status.revision.settled === 1);
    expect(created).toBe(1);

    target.apply({ ...setup(), canvas: { width: 1280, height: 720 } });
    target.apply(update(1, [source("a")]));
    await waitFor(() => created === 2 && target.status.phase === "settled");
    expect(disposed).toBe(1);
    await target.dispose();
  });

  it("evicts assets missing from a new setup and releases everything on dispose", async () => {
    const { store, released } = memoryStore();
    const target = createTarget({
      kind: "test",
      assets: store,
      fetchAsset: () => Promise.resolve(logoBytes),
      update: () => undefined,
    });
    target.apply(setup([logo]));
    target.apply(update(1, []));
    await target.settled(1);
    target.apply(setup([]));
    await waitFor(() => released.length === 1);
    expect(released).toEqual(["memory:logo.png"]);
    await target.dispose();
  });
});

/** Polls a condition across macrotasks, for effects that settle asynchronously. */
async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Condition was not met.");
}
