import { describe, expect, expectTypeOf, it } from "vitest";

import {
  decodeRemoteStoreSnapshot,
  defineRemoteStore,
  encodeRemoteStoreSnapshot,
  type RemoteSnapshotOf,
} from "./remote-store.js";
import {
  createRemoteStoreHandler,
  remoteStoreSnapshots,
  type ReadableContextStore,
} from "./remote-store-server.js";

interface TestStoreGetSnapshotContext {
  readonly title: string;
}

interface TestStoreGetSnapshot {
  readonly context: TestStoreGetSnapshotContext;
}

interface Context {
  readonly title: string;
}

interface RemoteStoreContract {
  readonly context: Context;
}

interface TestReadableStoreListenersSnapshot<TContext> {
  readonly context: TContext;
}

interface TestReadableStoreGetSnapshotResult<TContext> {
  readonly context: TContext;
}

interface TestReadableStoreSubscribeListenerSnapshot<TContext> {
  readonly context: TContext;
}

interface TestReadableStoreSubscribeResult {
  unsubscribe(): void;
}

interface CounterContext {
  readonly count: number;
}

interface TestStore {
  getSnapshot(): TestStoreGetSnapshot;
}

describe("remote store reference", () => {
  it("retains immutable application-owned identity and routing", () => {
    const ref = defineRemoteStore<TestStore>({
      id: "composition",
      url: "/api/store/composition",
    });

    expect(ref).toEqual({ id: "composition", url: "/api/store/composition" });
    expect(Object.isFrozen(ref)).toBe(true);
    expectTypeOf<RemoteSnapshotOf<typeof ref>>().toEqualTypeOf<RemoteStoreContract>();
  });

  it("derives the conventional endpoint from the ID unless one is supplied", () => {
    expect(defineRemoteStore<TestStore>({ id: "composition" }).url).toBe(
      "/__vignette/store/composition",
    );
    expect(defineRemoteStore<TestStore>({ id: "lower third" }).url).toBe(
      "/__vignette/store/lower%20third",
    );
    expect(defineRemoteStore<TestStore>({ id: "composition", url: undefined }).url).toBe(
      "/__vignette/store/composition",
    );
  });

  it("rejects empty identity and routing values", () => {
    expect(() => defineRemoteStore<TestStore>({ id: "", url: "/store" })).toThrow(
      "Remote store ID must not be empty.",
    );
    expect(() => defineRemoteStore<TestStore>({ id: "store", url: "" })).toThrow(
      "Remote store URL must not be empty.",
    );
  });
});

describe("remote store codec", () => {
  it("round-trips context snapshots", () => {
    const encoded = encodeRemoteStoreSnapshot({ context: { title: "Live" } });

    expect(decodeRemoteStoreSnapshot(encoded)).toEqual({ context: { title: "Live" } });
  });

  it("ignores malformed and unrelated event data", () => {
    expect(decodeRemoteStoreSnapshot("not json")).toBeUndefined();
    expect(decodeRemoteStoreSnapshot('{"value":1}')).toBeUndefined();
    expect(decodeRemoteStoreSnapshot("null")).toBeUndefined();
  });
});

describe("remote store snapshots", () => {
  it("replays the current context and conflates pending updates", async () => {
    const store = new TestReadableStore({ count: 0 });
    const iterator = remoteStoreSnapshots(store)[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { context: { count: 0 } },
    });
    store.emit({ count: 1 });
    store.emit({ count: 2 });
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { context: { count: 2 } },
    });

    await iterator.return?.();
    expect(store.subscriberCount).toBe(0);
  });

  it("stops and unsubscribes when aborted", async () => {
    const store = new TestReadableStore({ count: 0 });
    const controller = new AbortController();
    const iterator = remoteStoreSnapshots(store, controller.signal)[Symbol.asyncIterator]();
    await iterator.next();

    const pending = iterator.next();
    controller.abort();

    await expect(pending).resolves.toEqual({ done: true, value: undefined });
    expect(store.subscriberCount).toBe(0);
  });

  it("does not yield from a pre-aborted stream", async () => {
    const store = new TestReadableStore({ count: 0 });
    const controller = new AbortController();
    controller.abort();

    const iterator = remoteStoreSnapshots(store, controller.signal)[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(store.subscriberCount).toBe(0);
  });
});

describe("remote store handler", () => {
  it("streams the store at its reference URL and releases it when the client disconnects", async () => {
    // Other paths and methods fall through; the matching GET streams until the client cancels.
    const store = new TestReadableStore({ count: 0 });
    const ref = defineRemoteStore<TestReadableStore<CounterContext>>({ id: "counter" });
    const handler = createRemoteStoreHandler(ref, store);
    const client = new AbortController();

    expect(handler(new Request("https://show.test/__vignette/store/other"))).toBeUndefined();
    expect(
      handler(new Request("https://show.test/__vignette/store/counter", { method: "POST" })),
    ).toBeUndefined();
    const response = handler(
      new Request("https://show.test/__vignette/store/counter", { signal: client.signal }),
    );
    expect(response?.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    const reader = response?.body?.getReader();
    if (reader === undefined) throw new Error("The store stream has no body.");
    const decoder = new TextDecoder();
    const read = async () => decoder.decode((await reader.read()).value);

    await expect(read()).resolves.toBe('data: {"context":{"count":0}}\n\n');
    store.emit({ count: 1 });
    await expect(read()).resolves.toBe('data: {"context":{"count":1}}\n\n');

    await reader.cancel();
    await expect.poll(() => store.subscriberCount).toBe(0);
  });
});

class TestReadableStore<TContext> implements ReadableContextStore<TContext> {
  private readonly listeners = new Set<
    (snapshot: TestReadableStoreListenersSnapshot<TContext>) => void
  >();

  constructor(private context: TContext) {}

  get subscriberCount(): number {
    return this.listeners.size;
  }

  getSnapshot(): TestReadableStoreGetSnapshotResult<TContext> {
    return { context: this.context };
  }

  subscribe(
    listener: (snapshot: TestReadableStoreSubscribeListenerSnapshot<TContext>) => void,
  ): TestReadableStoreSubscribeResult {
    this.listeners.add(listener);
    return { unsubscribe: () => this.listeners.delete(listener) };
  }

  emit(context: TContext): void {
    this.context = context;
    for (const listener of this.listeners) listener({ context });
  }
}
