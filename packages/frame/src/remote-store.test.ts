import { describe, expect, expectTypeOf, it } from "vitest";

import {
  decodeRemoteStoreSnapshot,
  defineRemoteStore,
  encodeRemoteStoreSnapshot,
  type RemoteSnapshotOf,
} from "./remote-store.js";
import { remoteStoreSnapshots, type ReadableContextStore } from "./remote-store-server.js";

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
