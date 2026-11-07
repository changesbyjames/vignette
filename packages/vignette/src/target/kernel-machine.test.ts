import { describe, expect, it } from "vitest";
import { createActor, fromCallback, fromPromise, type AnyEventObject } from "xstate";

import type { AssetEntry } from "../core/assets.js";
import type { Snapshot, Source } from "../core/snapshot.js";
import type { SetupMessage } from "../stream/messages.js";
import type { TargetHandle } from "./kernel.js";
import { createKernelMachine, type ApplyOutput, type ApplyPlan } from "./kernel-machine.js";

interface FakeHandle extends TargetHandle {
  readonly name: string;
}

/** One `createHandle` actor the machine started. */
interface CreateCall {
  readonly source: Source;
  readonly send: (event: AnyEventObject) => void;
  stopped: boolean;
}

/** One `apply` the machine started, resolved by the test. */
interface ApplyCall {
  readonly plan: ApplyPlan<FakeHandle>;
  readonly finish: (output: ApplyOutput) => void;
}

/** The asset stage the machine started. */
interface AssetStage {
  readonly setup: SetupMessage;
  readonly send: (event: AnyEventObject) => void;
  stopped: boolean;
}

/** The machine with fake I/O, and what the fakes saw. */
function harness() {
  const creates: CreateCall[] = [];
  const applies: ApplyCall[] = [];
  const stages: AssetStage[] = [];
  const disposed: FakeHandle[] = [];
  const evicted: (readonly AssetEntry[])[] = [];
  const routed: string[] = [];
  const machine = createKernelMachine<FakeHandle>().provide({
    actors: {
      ensureAssets: fromCallback(({ input, sendBack }) => {
        const stage: AssetStage = { setup: input, send: sendBack, stopped: false };
        stages.push(stage);
        return () => {
          stage.stopped = true;
        };
      }),
      createHandle: fromCallback(({ input, sendBack }) => {
        const call: CreateCall = { source: input.source, send: sendBack, stopped: false };
        creates.push(call);
        return () => {
          call.stopped = true;
        };
      }),
      apply: fromPromise(
        ({ input }) =>
          new Promise<ApplyOutput>((finish) => {
            applies.push({ plan: input, finish });
          }),
      ),
    },
    actions: {
      disposeHandles: (_, handles) => {
        disposed.push(...handles);
      },
      evictAssets: (_, keep) => {
        evicted.push(keep);
      },
      route: (_, { event, handles }) => {
        routed.push(`${event.kind}:${[...handles.keys()].join(",")}`);
      },
    },
  });
  // Every kind has a plugin except "moq".
  const actor = createActor(machine, { input: { assets: true, plugins: new Set(["color"]) } });
  actor.start();
  return { actor, creates, applies, stages, disposed, evicted, routed };
}

type Harness = ReturnType<typeof harness>;

/** Lets promise actors settle and their done events arrive. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function setup(assets = 0): SetupMessage {
  return {
    kind: "setup",
    id: "show",
    canvas: { width: 1920, height: 1080 },
    assets: {
      version: "v1",
      entries: Array.from({ length: assets }, (_, index) => ({
        name: `asset-${String(index)}.png`,
        hash: `sha256-${String(index)}`,
      })),
    },
    serve: { assets: "https://show.example/assets/" },
  };
}

function color(id: string, value = "#000000"): Source {
  return { id, kind: "color", props: { color: value }, size: { width: 10, height: 10 } };
}

function snapshot(revision: number, sources: readonly Source[]): Snapshot {
  return {
    revision,
    id: "show",
    canvas: { width: 1920, height: 1080 },
    sources,
    scenes: [{ id: "main", items: [] }],
  };
}

/** A harness past setup with no assets: ready and idle. */
async function ready(): Promise<Harness> {
  const kernel = harness();
  kernel.actor.send({ type: "setup", setup: setup() });
  await flush();
  return kernel;
}

function update(kernel: Harness, revision: number, sources: readonly Source[]): void {
  kernel.actor.send({ type: "update", snapshot: snapshot(revision, sources) });
}

/** Resolves the latest apply and lets its result arrive. */
async function finishApply(kernel: Harness, output: ApplyOutput = { failed: [] }): Promise<void> {
  kernel.applies.at(-1)?.finish(output);
  await flush();
}

function statuses(kernel: Harness) {
  return Object.fromEntries(
    [...kernel.actor.getSnapshot().context.handles].map(([id, entry]) => [id, entry.status]),
  );
}

describe("target kernel machine", () => {
  it("fails a revision using a kind without a plugin before touching anything", async () => {
    const kernel = await ready();
    update(kernel, 1, [color("a")]);
    await flush();
    const handle: FakeHandle = { name: "a" };
    kernel.creates[0]?.send({ type: "handleCreated", id: "a", handle, source: color("a") });
    await finishApply(kernel);
    await finishApply(kernel);
    const applied = kernel.applies.length;

    update(kernel, 2, [color("a", "#ffffff"), { ...color("m"), kind: "moq" }]);
    await flush();
    expect(kernel.actor.getSnapshot().context).toMatchObject({
      desired: 2,
      settled: 1,
      failed: 2,
      error: new Error('missing source plugin for kind "moq"'),
    });
    expect({ applies: kernel.applies.length, creates: kernel.creates.length }).toEqual({
      applies: applied,
      creates: 1,
    });
    expect(kernel.disposed).toEqual([]);

    // A later revision without the kind applies as usual and clears the error.
    update(kernel, 3, [color("a", "#ffffff")]);
    await flush();
    expect(kernel.applies.at(-1)?.plan.updates).toMatchObject([{ id: "a" }]);
    await finishApply(kernel);
    expect(kernel.actor.getSnapshot().context).toMatchObject({ settled: 3, error: undefined });
  });

  it("goes straight to the asset stage after setup and reports progress", async () => {
    const kernel = harness();
    kernel.actor.send({ type: "setup", setup: setup(2) });
    await flush();
    expect(kernel.actor.getSnapshot().value).toBe("downloading-assets");
    expect(kernel.stages).toHaveLength(1);

    kernel.stages[0]?.send({ type: "assetProgress", name: "asset-0.png" });
    kernel.stages[0]?.send({ type: "assetProgress", name: "asset-1.png", error: new Error("404") });
    expect(kernel.actor.getSnapshot().context.assets).toEqual({
      done: 1,
      total: 2,
      failed: ["asset-1.png"],
    });

    kernel.stages[0]?.send({ type: "assetsDone", error: new Error("1 asset failed") });
    expect(kernel.actor.getSnapshot().value).toBe("error");
  });

  it("holds updates during the asset stage and applies only the latest", async () => {
    const kernel = harness();
    kernel.actor.send({ type: "setup", setup: setup(1) });
    await flush();
    update(kernel, 1, [color("a")]);
    update(kernel, 2, [color("b")]);
    expect(kernel.applies).toEqual([]);
    expect(kernel.actor.getSnapshot().context).toMatchObject({
      desired: 2,
      pending: { revision: 2 },
    });

    kernel.stages[0]?.send({ type: "assetsDone" });
    await flush();
    expect(kernel.actor.getSnapshot().value).toEqual({ ready: "applying" });
    expect(kernel.creates.map((call) => call.source.id)).toEqual(["b"]);
    expect(kernel.applies.map((call) => call.plan.snapshot.revision)).toEqual([2]);
  });

  it("creates, updates and disposes handles by source ID", async () => {
    const kernel = await ready();
    const handle: FakeHandle = { name: "a" };
    update(kernel, 1, [color("a")]);
    await flush();
    expect(kernel.applies[0]?.plan.handles.size).toBe(0);

    kernel.creates[0]?.send({ type: "handleCreated", id: "a", handle, source: color("a") });
    expect(kernel.creates[0]?.stopped).toBe(true);
    await finishApply(kernel);
    // The handle arrived mid-apply, so the same revision is applied once more, with it.
    expect(kernel.applies[1]?.plan.handles).toEqual(new Map([["a", handle]]));
    await finishApply(kernel);
    expect(kernel.actor.getSnapshot().context.settled).toBe(1);
    expect(statuses(kernel)).toEqual({ a: "live" });

    update(kernel, 2, [color("a", "#ffffff")]);
    await flush();
    expect(kernel.applies[2]?.plan.updates).toEqual([
      { id: "a", handle, source: color("a", "#ffffff") },
    ]);
    await finishApply(kernel);

    update(kernel, 3, []);
    await flush();
    expect(kernel.applies[3]?.plan.disposals).toEqual([handle]);
    expect(statuses(kernel)).toEqual({});
  });

  it("updates a handle whose source changed while its create was pending", async () => {
    const kernel = await ready();
    update(kernel, 1, [color("a")]);
    await flush();
    await finishApply(kernel);
    update(kernel, 2, [color("a", "#ffffff")]);
    await flush();
    await finishApply(kernel);
    expect(kernel.creates).toHaveLength(1);

    const handle: FakeHandle = { name: "a" };
    kernel.creates[0]?.send({ type: "handleCreated", id: "a", handle, source: color("a") });
    await flush();
    expect(kernel.applies[2]?.plan.updates).toEqual([
      { id: "a", handle, source: color("a", "#ffffff") },
    ]);
  });

  it("marks a rejected create or a failed handle update as a source error and carries on", async () => {
    const kernel = await ready();
    update(kernel, 1, [color("a"), color("b")]);
    await flush();
    kernel.creates[0]?.send({ type: "handleFailed", id: "a", error: new Error("boom") });
    kernel.creates[1]?.send({
      type: "handleCreated",
      id: "b",
      handle: { name: "b" },
      source: color("b"),
    });
    await finishApply(kernel);
    await finishApply(kernel, { failed: [{ id: "b", error: new Error("update failed") }] });
    expect(statuses(kernel)).toEqual({ a: "error", b: "error" });
    const { handles } = kernel.actor.getSnapshot().context;
    expect([handles.get("a")?.error?.message, handles.get("b")?.error?.message]).toEqual([
      "boom",
      "update failed",
    ]);
    expect(kernel.actor.getSnapshot().context.settled).toBe(1);

    // A failed source is created again once its source changes.
    update(kernel, 2, [color("a", "#ffffff"), color("b")]);
    await flush();
    expect(kernel.creates.map((call) => call.source)).toContainEqual(color("a", "#ffffff"));
    expect(statuses(kernel)).toEqual({ a: "preparing", b: "error" });
  });

  it("stops a pending create whose source was removed", async () => {
    const kernel = await ready();
    update(kernel, 1, [color("a")]);
    await flush();
    await finishApply(kernel);
    update(kernel, 2, []);
    await flush();
    expect(kernel.creates[0]?.stopped).toBe(true);
    expect(statuses(kernel)).toEqual({});
  });

  it("records a failed apply and clears it with the next successful one", async () => {
    const kernel = await ready();
    update(kernel, 1, []);
    await flush();
    await finishApply(kernel, { failed: [], error: new Error("medium down") });
    expect(kernel.actor.getSnapshot().context).toMatchObject({ failed: 1, settled: undefined });
    expect(kernel.actor.getSnapshot().context.error?.message).toBe("medium down");

    update(kernel, 2, []);
    await flush();
    await finishApply(kernel);
    expect(kernel.actor.getSnapshot().context).toMatchObject({
      settled: 2,
      failed: undefined,
      error: undefined,
    });
  });

  it("resets on a new setup: handles disposed, assets evicted, work in flight stopped", async () => {
    const kernel = await ready();
    const handle: FakeHandle = { name: "a" };
    update(kernel, 1, [color("a"), color("b")]);
    await flush();
    kernel.creates[0]?.send({ type: "handleCreated", id: "a", handle, source: color("a") });
    await finishApply(kernel);

    const next = setup(1);
    kernel.actor.send({ type: "setup", setup: next });
    expect(kernel.disposed).toEqual([handle]);
    // The first setup evicted everything but its own (empty) manifest.
    expect(kernel.evicted).toEqual([[], next.assets.entries]);
    expect(kernel.creates[1]?.stopped).toBe(true);
    expect(kernel.actor.getSnapshot().value).toBe("downloading-assets");
    expect(kernel.actor.getSnapshot().context).toMatchObject({
      desired: undefined,
      settled: undefined,
      setup: next,
    });
    expect(statuses(kernel)).toEqual({});

    await flush();
    kernel.actor.send({ type: "setup", setup: setup() });
    expect(kernel.stages[0]?.stopped).toBe(true);
  });

  it("routes events with the live handles and records the connection", async () => {
    const kernel = await ready();
    update(kernel, 1, [color("a"), color("b")]);
    await flush();
    kernel.creates[0]?.send({
      type: "handleCreated",
      id: "a",
      handle: { name: "a" },
      source: color("a"),
    });
    kernel.actor.send({ type: "event", event: { kind: "flash" } });
    expect(kernel.routed).toEqual(["flash:a"]);

    const connection = { phase: "retry-wait", error: new Error("refused") } as const;
    kernel.actor.send({ type: "connection", connection });
    expect(kernel.actor.getSnapshot().context.connection).toBe(connection);
  });

  it("enters error when a followed stream fails and ends on dispose", async () => {
    const kernel = await ready();
    kernel.actor.send({
      type: "follow",
      id: "follow:0",
      stream: {
        [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error("gone")) }),
      },
    });
    await flush();
    expect(kernel.actor.getSnapshot().value).toBe("error");
    expect(kernel.actor.getSnapshot().context.error?.message).toBe("gone");

    kernel.actor.send({ type: "dispose" });
    expect(kernel.actor.getSnapshot().status).toBe("done");
  });
});
