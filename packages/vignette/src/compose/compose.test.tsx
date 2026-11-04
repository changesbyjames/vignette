import { useEffect, useState, useSyncExternalStore } from "react";
import { describe, expect, it, vi } from "vitest";

import { Browser } from "../core/sources/browser.js";
import { Color } from "../core/sources/color.js";
import type { LayoutEngine, LayoutRecord } from "../core/layout/layout-engine.js";
import type { Size } from "../core/geometry.js";
import type { LayoutNode } from "../core/show-tree.js";
import type { Snapshot } from "../core/snapshot.js";
import { Layer, Scene, Show, Use } from "../react-authoring/elements.js";
import type { StreamMessage } from "../stream/messages.js";
import { compose } from "./compose.js";

const canvas = { width: 1280, height: 720 };

describe("compose", () => {
  it("uses a supplied layout engine without loading the default Yoga build", async () => {
    const layout = vi.fn<LayoutEngine["layout"]>((nodes, size) => fullFrames(nodes, size));
    const composer = compose(colorShow("#112233"), { layout: { layout } });

    const snapshot = await composer.ready();

    expect(layout).toHaveBeenCalledOnce();
    expect(snapshot.scenes[0]?.items[0]?.frame).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
    composer.dispose();
  });

  it("composes a component and publishes setup before the first update", async () => {
    function Weekly() {
      return colorShow("#445566");
    }
    const manifest = {
      version: "v1",
      entries: [{ name: "logo.png", hash: "sha256-abc" }],
    } as const;
    const composer = compose(Weekly, {
      assets: manifest,
      serve: { stream: "https://show.example/stream" },
    });

    const snapshot = await composer.ready();
    expect(snapshot).toMatchObject({
      id: "weekly",
      canvas,
      sources: [{ id: "main.0", kind: "color", props: { color: "#445566" } }],
    });

    const controller = new AbortController();
    const iterator = composer.stream(controller.signal)[Symbol.asyncIterator]();
    expect(await next(iterator)).toEqual({
      kind: "setup",
      id: "weekly",
      canvas,
      kinds: ["color"],
      assets: manifest,
      serve: { stream: "https://show.example/stream" },
    });
    expect(await next(iterator)).toEqual({ kind: "update", snapshot });
    controller.abort();
    composer.dispose();
  });

  it("publishes snapshots for state updates originating inside the show", async () => {
    vi.useFakeTimers();
    try {
      function TimerShow() {
        const [tick, setTick] = useState(0);
        useEffect(() => {
          const timer = setInterval(() => {
            setTick((value) => value + 1);
          }, 1000);
          return () => {
            clearInterval(timer);
          };
        }, []);
        return colorShow(tick % 2 === 0 ? "#111111" : "#222222");
      }
      const composer = compose(<TimerShow />, { layout: fakeLayout });
      const colors = collectColors(composer.stream());

      await composer.ready();
      await vi.advanceTimersByTimeAsync(1000);
      await vi.waitFor(() => {
        expect(colors).toEqual(['"#111111"', '"#222222"']);
      });
      composer.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the last valid snapshot and reports diagnostics when a later commit is invalid", async () => {
    const store = createStore("#111111");
    const onError = vi.fn<(error: Error) => void>();
    const composer = compose(<StoreShow store={store} />, { layout: fakeLayout, onError });
    const first = await composer.ready();

    store.set("missing");

    await expect(composer.settled()).rejects.toThrow(/no source in <Show> declares/u);
    expect(composer.snapshot).toBe(first);
    expect(composer.status).toMatchObject({
      phase: "error",
      compiledRevision: first.revision,
      diagnostics: [{ code: "MISSING_SOURCE", path: "scene.main.layer.main.0" }],
    });
    expect(onError).toHaveBeenCalledOnce();

    store.set("#222222");
    await expect(composer.settled()).resolves.toMatchObject({
      sources: [{ props: { color: "#222222" } }],
    });
    expect(composer.status.phase).toBe("ready");
    expect(composer.status.error).toBeUndefined();
    composer.dispose();
  });

  it("reports a render error as status, not as an exception", async () => {
    function Broken(): never {
      throw new Error("boom");
    }
    const onError = vi.fn<(error: Error) => void>();
    const composer = compose(<Broken />, { layout: fakeLayout, onError });

    await expect(composer.ready()).rejects.toThrow("boom");
    expect(composer.status.phase).toBe("error");
    expect(composer.status.error?.message).toBe("boom");
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }));
    composer.dispose();
  });

  it("notifies status subscribers with stable snapshots", async () => {
    const composer = compose(colorShow("#111111"), { layout: fakeLayout });
    const phases: string[] = [];
    composer.subscribe(() => phases.push(composer.status.phase));

    await composer.ready();
    expect(composer.status).toBe(composer.status);
    expect(composer.status).toMatchObject({ phase: "ready", revision: 1, compiledRevision: 1 });
    composer.dispose();
    expect(phases).toEqual(["ready", "disposed"]);
  });
});

describe("show identity", () => {
  it("fails a commit that changes the show's id or canvas and keeps the first show live", async () => {
    const store = createStore("weekly");
    const onError = vi.fn<(error: Error) => void>();
    const composer = compose(<IdentityShow store={store} />, { layout: fakeLayout, onError });
    const first = await composer.ready();

    store.set("daily");
    await expect(composer.settled()).rejects.toThrow(/composes one show/u);
    expect(composer.snapshot).toBe(first);
    expect(composer.status).toMatchObject({
      phase: "error",
      diagnostics: [{ code: "SHOW_IDENTITY_CHANGED", path: "show" }],
    });

    store.set("wide");
    await expect(composer.settled()).rejects.toThrow(/1280x720 cannot become "weekly" 1920x1080/u);

    store.set("weekly");
    await expect(composer.settled()).resolves.toMatchObject({ id: "weekly" });
    expect(composer.status.phase).toBe("ready");
    composer.dispose();
  });

  it("publishes setup once and again only when a new source kind appears", async () => {
    const store = createStore("color");
    const composer = compose(<KindShow store={store} />, { layout: fakeLayout });
    await composer.ready();
    const messages: StreamMessage[] = [];
    const controller = new AbortController();
    void (async () => {
      for await (const message of composer.stream(controller.signal)) messages.push(message);
    })();

    for (const next of ["#222222", "browser", "color", "browser"]) {
      store.set(next);
      await composer.settled();
    }
    await vi.waitFor(() => {
      expect(messages.filter((message) => message.kind === "update")).toHaveLength(5);
    });

    const setups = messages.flatMap((message) => (message.kind === "setup" ? [message.kinds] : []));
    expect(setups).toEqual([["color"], ["browser", "color"]]);
    controller.abort();
    composer.dispose();
  });
});

describe("Composer.once", () => {
  it("renders once, disposes, and resolves to the snapshot", async () => {
    const cleanup = vi.fn<() => void>();
    function OneShot() {
      useEffect(() => cleanup, []);
      return colorShow("#222222");
    }
    const composer = compose(OneShot);

    const snapshot = await composer.once();

    expect(snapshot.id).toBe("weekly");
    expect(snapshot.sources[0]).toMatchObject({ kind: "color", size: canvas });
    expect(snapshot.scenes[0]?.items[0]?.frame).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
    expect(composer.status.phase).toBe("disposed");
    expect(cleanup).toHaveBeenCalledOnce();
    await expect(composer.settled()).rejects.toThrow(/disposed/u);
  });

  it("rejects when the show fails to compile", async () => {
    const broken = (
      <Show id="broken" canvas={canvas}>
        <Scene id="main">
          <Layer>
            <Use source="missing" />
          </Layer>
        </Scene>
      </Show>
    );

    await expect(compose(broken, { layout: fakeLayout }).once()).rejects.toThrow(
      /no source in <Show> declares/u,
    );
  });
});

describe("Composer.settled", () => {
  it("flushes external-store changes and resolves the latest synchronous change", async () => {
    const store = createStore("#111111");
    const composer = compose(<StoreShow store={store} />, { layout: fakeLayout });
    await composer.ready();

    store.set("#222222");
    store.set("#333333");

    const snapshot = await composer.settled();
    expect(snapshot.sources[0]?.props).toMatchObject({ color: "#333333" });
    expect(snapshot.revision).toBeGreaterThan(1);
    composer.dispose();
  });

  it("clears React's development measures on each commit and keeps the host's own", async () => {
    // React's development build files a measure per component render on these tracks. It does so
    // only when `console.timeStamp` exists, which Vitest's console lacks, so the test files them.
    const reactMeasure = (name: string, devtools: Record<string, string>) =>
      performance.measure(name, { start: 0, end: 1, detail: { devtools } });
    performance.measure("host measure", {
      start: 0,
      end: 1,
      detail: { devtools: { track: "Host" } },
    });
    const store = createStore("#111111");
    const composer = compose(<StoreShow store={store} />, { layout: fakeLayout });
    await composer.ready();

    reactMeasure("\u200bLayer", { track: "Components ⚛" });
    reactMeasure("Update", { track: "Blocking", trackGroup: "Scheduler ⚛" });
    store.set("#222222");
    await composer.settled();

    const names = performance.getEntriesByType("measure").map((entry) => entry.name);
    expect(names).toEqual(["host measure"]);
    composer.dispose();
    performance.clearMeasures("host measure");
  });

  it("resolves immediately to the current snapshot when no work is pending", async () => {
    const composer = compose(<StoreShow store={createStore("#111111")} />, { layout: fakeLayout });
    await composer.ready();

    await expect(composer.settled()).resolves.toBe(composer.snapshot);
    composer.dispose();
  });

  it("replays setup and the latest update and streams events without changing replay state", async () => {
    const composer = compose(<StoreShow store={createStore("#111111")} />, { layout: fakeLayout });
    await composer.ready();
    const event = { kind: "media:restart", sourceId: "main.0" };
    composer.emit(event);

    const controller = new AbortController();
    const iterator = composer.stream(controller.signal)[Symbol.asyncIterator]();
    const replay = [await next(iterator), await next(iterator)];
    expect(replay.map((message) => message.kind)).toEqual(["setup", "update"]);

    composer.emit(event);
    expect(await next(iterator)).toEqual({ kind: "event", event });
    controller.abort();
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });

    const late = composer.stream()[Symbol.asyncIterator]();
    expect((await next(late)).kind).toBe("setup");
    expect((await next(late)).kind).toBe("update");
    composer.dispose();
    await expect(late.next()).resolves.toEqual({ done: true, value: undefined });
    // A disposed composer replays nothing, so a reconnect to a server shutting down gets no show.
    const afterDispose = composer.stream()[Symbol.asyncIterator]();
    await expect(afterDispose.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it("narrows a stream to one source, sent only when that source changes", async () => {
    const left = createStore("#111111");
    const right = createStore("#222222");
    const composer = compose(<PairShow left={left} right={right} />, { layout: fakeLayout });
    await composer.ready();
    const controller = new AbortController();
    const narrowed = composer.stream(controller.signal, { source: "right" });
    const iterator = narrowed[Symbol.asyncIterator]();

    expect((await next(iterator)).kind).toBe("setup");
    expect(narrowedTo(await next(iterator))).toEqual({ sources: ['right:"#222222"'], scenes: 0 });

    // Another source changing, and events for it, send this page nothing.
    left.set("#333333");
    await composer.settled();
    composer.emit({ kind: "media:restart", sourceId: "left" });
    composer.emit({ kind: "flash" });
    expect(await next(iterator)).toEqual({ kind: "event", event: { kind: "flash" } });

    right.set("#444444");
    expect(narrowedTo(await next(iterator))).toEqual({ sources: ['right:"#444444"'], scenes: 0 });
    right.set("gone");
    expect(narrowedTo(await next(iterator))).toEqual({ sources: [], scenes: 0 });
    controller.abort();
    composer.dispose();
  });
});

interface StoreShowProps {
  readonly store: ReturnType<typeof createStore>;
}

/** A color from an external store; the value `missing` places an undeclared shared source. */
function StoreShow(props: StoreShowProps) {
  const color = useSyncExternalStore(props.store.subscribe, props.store.get);
  return (
    <Show id="weekly" canvas={canvas}>
      <Scene id="main">
        <Layer>{color === "missing" ? <Use source="missing" /> : <Color color={color} />}</Layer>
      </Scene>
    </Show>
  );
}

interface PairShowProps {
  readonly left: ReturnType<typeof createStore>;
  readonly right: ReturnType<typeof createStore>;
}

/** Two shared colors from two stores; `gone` drops the right one. */
function PairShow(props: PairShowProps) {
  const left = useSyncExternalStore(props.left.subscribe, props.left.get);
  const right = useSyncExternalStore(props.right.subscribe, props.right.get);
  return (
    <Show id="weekly" canvas={canvas}>
      <Color id="left" color={left} />
      {right === "gone" ? null : <Color id="right" color={right} />}
      <Scene id="main">
        <Layer>
          <Use source="left" />
        </Layer>
        {right === "gone" ? null : (
          <Layer>
            <Use source="right" />
          </Layer>
        )}
      </Scene>
    </Show>
  );
}

/** An update's sources as `id:color`, and how many scenes it carries. */
function narrowedTo(message: StreamMessage) {
  if (message.kind !== "update") throw new Error(`Expected an update, got ${message.kind}.`);
  return {
    sources: message.snapshot.sources.map(
      (source) => `${source.id}:${JSON.stringify(source.props.color)}`,
    ),
    scenes: message.snapshot.scenes.length,
  };
}

/** `daily` changes the show's id and `wide` its canvas; anything else is the `weekly` show. */
function IdentityShow(props: StoreShowProps) {
  const value = useSyncExternalStore(props.store.subscribe, props.store.get);
  return (
    <Show
      id={value === "daily" ? "daily" : "weekly"}
      canvas={value === "wide" ? { width: 1920, height: 1080 } : canvas}
    >
      <Scene id="main">
        <Layer>
          <Color color="#111111" />
        </Layer>
      </Scene>
    </Show>
  );
}

/** A color, or a browser source when the store says `browser`. */
function KindShow(props: StoreShowProps) {
  const value = useSyncExternalStore(props.store.subscribe, props.store.get);
  return (
    <Show id="weekly" canvas={canvas}>
      <Scene id="main">
        <Layer>
          {value === "browser" ? (
            <Browser url="https://example.com/" />
          ) : (
            <Color color={value === "color" ? "#111111" : value} />
          )}
        </Layer>
      </Scene>
    </Show>
  );
}

function colorShow(color: string) {
  return (
    <Show id="weekly" canvas={canvas}>
      <Scene id="main">
        <Layer style={{ width: "100%", height: "100%" }}>
          <Color color={color} />
        </Layer>
      </Scene>
    </Show>
  );
}

function createStore(initial: string) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: string) => {
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Lays every node over the whole canvas; enough to compile without Yoga. */
function fullFrames(nodes: readonly LayoutNode[], size: Size): LayoutRecord[] {
  return nodes.map((node, index): LayoutRecord => ({
    node,
    frame: { x: 0, y: 0, width: size.width, height: size.height },
    path: `children[${String(index)}]`,
    children: "children" in node ? fullFrames(node.children, size) : [],
  }));
}

const fakeLayout: LayoutEngine = { layout: fullFrames };

function collectColors(stream: AsyncIterable<StreamMessage>): string[] {
  const colors: string[] = [];
  void (async () => {
    for await (const message of stream) {
      if (message.kind === "update") colors.push(colorOf(message.snapshot));
    }
  })();
  return colors;
}

function colorOf(snapshot: Snapshot): string {
  return JSON.stringify(snapshot.sources[0]?.props.color);
}

async function next(iterator: AsyncIterator<StreamMessage>): Promise<StreamMessage> {
  const result = await iterator.next();
  if (result.done === true) throw new Error("The stream ended unexpectedly.");
  return result.value;
}
