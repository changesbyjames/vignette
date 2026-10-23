// @vitest-environment jsdom
import { BroadcastChannel, locks } from "node:worker_threads";
import { renderToString } from "react-dom/server";
import { createElement, Suspense, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { frame } from "./definition.js";
import type * as SharedStream from "./shared-stream.js";
import { frameElement } from "./frame-element.js";

import { useRemoteStore } from "./remote-store-client.js";
import { defineRemoteStore } from "./remote-store.js";

interface TestStoreGetSnapshotContext {
  readonly title: string;
}

interface TestStoreGetSnapshot {
  readonly context: TestStoreGetSnapshotContext;
}

interface FakeEventSourceOnmessageEvent {
  readonly data: string;
}

interface ReceivedByPage {
  readonly a: string[];
  readonly b: string[];
  readonly c: string[];
}

interface FakeNamedEventSourceEvent {
  readonly data: string;
}

interface TestStore {
  getSnapshot(): TestStoreGetSnapshot;
}

describe("useRemoteStore", () => {
  afterEach(() => {
    FakeEventSource.instances.length = 0;
    vi.unstubAllGlobals();
  });

  it("suspends until the first snapshot and reuses the connection by URL", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("EventSource", FakeEventSource);
    const url = `/api/store/client-test-${crypto.randomUUID()}`;
    const ref = defineRemoteStore<TestStore>({ id: "composition", url });

    expect(render(ref)).toContain("Waiting");
    expect(FakeEventSource.instances).toHaveLength(1);

    FakeEventSource.instances[0]?.emit('{"context":{"title":"Live"}}');

    expect(render(ref)).toContain("Live");
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("ignores malformed messages while waiting for a snapshot", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("EventSource", FakeEventSource);
    const ref = defineRemoteStore<TestStore>({ id: `malformed-test-${crypto.randomUUID()}` });

    render(ref);
    FakeEventSource.instances[0]?.emit("not json");

    expect(render(ref)).toContain("Waiting");
  });
});

describe("subscribeSharedEvent", () => {
  afterEach(() => {
    FakeNamedEventSource.instances.length = 0;
    vi.unstubAllGlobals();
  });

  it("shares one connection across pages and hands it over when the leader leaves", async () => {
    // Each fresh module instance stands in for a separate frame page on the same origin. jsdom
    // has neither Web Locks nor BroadcastChannel, so the pages share Node's real ones.
    vi.stubGlobal("navigator", { locks });
    vi.stubGlobal("BroadcastChannel", BroadcastChannel);
    vi.stubGlobal("EventSource", FakeNamedEventSource);
    const url = `/stream-${crypto.randomUUID()}`;
    // Load sequentially: concurrent loads would interleave the resets and share one instance.
    const pageA = await loadPage();
    const pageB = await loadPage();
    const pageC = await loadPage();
    expect(new Set([pageA, pageB, pageC]).size).toBe(3);
    const received: ReceivedByPage = { a: [], b: [], c: [] };

    const leaveA = pageA.subscribeSharedEvent(url, "update", (data) => received.a.push(data));
    await expect.poll(() => FakeNamedEventSource.instances.length).toBe(1);
    const leaveB = pageB.subscribeSharedEvent(url, "update", (data) => received.b.push(data));

    FakeNamedEventSource.instances[0]?.emit("update", "first");
    await expect.poll(() => received.b).toEqual(["first"]);
    expect(received.a).toEqual(["first"]);
    expect(FakeNamedEventSource.instances).toHaveLength(1);

    // A page that joins later gets the latest event straight away rather than the next one.
    const leaveC = pageC.subscribeSharedEvent(url, "update", (data) => received.c.push(data));
    await expect.poll(() => received.c).toEqual(["first"]);

    leaveA();
    expect(FakeNamedEventSource.instances[0]?.closed).toBe(true);
    await expect.poll(() => FakeNamedEventSource.instances.length).toBe(2);
    FakeNamedEventSource.instances[1]?.emit("update", "second");
    await expect.poll(() => [received.b.at(-1), received.c.at(-1)]).toEqual(["second", "second"]);

    leaveB();
    leaveC();
  });
});

describe("mountFrame", () => {
  afterEach(() => {
    FakeNamedEventSource.instances.length = 0;
    vi.unstubAllGlobals();
  });

  it("hydrates with server props, then re-renders in place when the placement's props change", async () => {
    // jsdom has no Web Locks, so this page takes the direct-connection path.
    vi.stubGlobal("EventSource", FakeNamedEventSource);
    const { mountFrame } = await import("./client.js");
    const greeting = frame({
      params: z.object({ name: z.string() }),
      view: ({ name }) => createElement("strong", null, `Hello ${name}`),
    });
    const markup = renderToString(frameElement(greeting, { name: "Ada" }));
    document.body.innerHTML = `<div data-vignette-frame-root>${markup}</div>`;
    const recoverable = vi.spyOn(console, "error");
    const root = document.querySelector("[data-vignette-frame-root]");

    const unmount = mountFrame(greeting, {
      sourceId: "lower-third",
      stream: "/stream",
      initialProps: { name: "Ada" },
    });
    const stream = FakeNamedEventSource.instances[0];
    expect(stream?.url).toBe(new URL("/stream", document.baseURI).href);

    stream?.emit("update", updateWith("other", { name: "Grace" }));
    stream?.emit("update", updateWith("lower-third", { name: "Ada" }));
    stream?.emit("update", updateWith("lower-third", { name: "Lin" }));
    await expect.poll(() => root?.textContent).toBe("Hello Lin");
    expect(FakeNamedEventSource.instances).toHaveLength(1);
    // Props that change before hydration finishes must not throw away the server markup.
    expect(recoverable).not.toHaveBeenCalled();

    unmount();
    expect(stream?.closed).toBe(true);
    // Let React's scheduler finish its queued work before the stubbed window is removed.
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});

async function loadPage(): Promise<typeof SharedStream> {
  vi.resetModules();
  return import("./shared-stream.js");
}

function updateWith(sourceId: string, props: Readonly<Record<string, string>>): string {
  return JSON.stringify({
    sources: [
      { id: sourceId, definition: { kind: "source:browser", id: sourceId, url: "/", props } },
    ],
  });
}

function render(ref: ReturnType<typeof defineRemoteStore<TestStore>>): string {
  function Selection(): ReactElement {
    const title = useRemoteStore(ref, (snapshot) => snapshot.context.title);
    return <span>{title}</span>;
  }

  return renderToString(
    <Suspense fallback={<span>Waiting</span>}>
      <Selection />
    </Suspense>,
  );
}

class FakeEventSource {
  static readonly instances: FakeEventSource[] = [];
  onmessage: ((event: FakeEventSourceOnmessageEvent) => void) | null = null;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  emit(data: string): void {
    this.onmessage?.({ data });
  }
}

class FakeNamedEventSource {
  static readonly instances: FakeNamedEventSource[] = [];
  private readonly listeners = new Map<string, Set<(event: FakeNamedEventSourceEvent) => void>>();
  closed = false;

  constructor(readonly url: string) {
    FakeNamedEventSource.instances.push(this);
  }

  addEventListener(event: string, listener: (event: FakeNamedEventSourceEvent) => void): void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  emit(event: string, data: string): void {
    for (const listener of this.listeners.get(event) ?? []) listener({ data });
  }

  close(): void {
    this.closed = true;
  }
}
