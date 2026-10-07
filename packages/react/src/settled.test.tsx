import { omitUndefined } from "@strangecyan/vignette-core";
import type { LayoutEngine, RuntimeMessage } from "@strangecyan/vignette-core";
import { useSyncExternalStore } from "react";
import { describe, expect, it } from "vitest";

import { defineComposition } from "./composition.js";
import { Broadcast, ColorSource, Scene, Sources } from "./primitives.js";
import { createComposerRoot } from "./root.js";

interface StoreShowProps {
  readonly store: ReturnType<typeof createStore>;
}

interface MakeRootAssetsAssets {
  readonly name: string;
  readonly url: string;
  readonly integrity?: `sha256-${string}`;
}

interface MakeRootAssets {
  readonly version: 1;
  readonly assets: readonly MakeRootAssetsAssets[];
}

describe("ComposerRoot.settled", () => {
  it("flushes external-store changes and resolves the latest synchronous change", async () => {
    const store = createStore("#111111");
    const root = makeRoot();

    await root.render(<StoreShow store={store} />);
    store.set("#222222");
    store.set("#333333");

    const snapshot = await root.settled();
    expect(snapshot.sources[0]?.definition).toMatchObject({ color: "#333333" });
    expect(snapshot.revision).toBeGreaterThan(1);
    await root.dispose();
  });

  it("resolves immediately to the current snapshot when no work is pending", async () => {
    const root = makeRoot();
    await root.render(<StoreShow store={createStore("#111111")} />);

    await expect(root.settled()).resolves.toBe(root.snapshot);
    await root.dispose();
  });

  it("replays setup and the latest update and streams events without changing replay state", async () => {
    const root = makeRoot({
      version: 1,
      assets: [{ name: "logo.png", url: "/logo.png", integrity: "sha256-test" }],
    });
    await root.render(<StoreShow store={createStore("#111111")} />);
    const event = { id: "select-main", kind: "scene:select", sceneId: "main" } as const;
    root.publishEvent(event);

    const controller = new AbortController();
    const iterator = root.messages(controller.signal)[Symbol.asyncIterator]();
    const replay = [await next(iterator), await next(iterator)];
    expect(replay.map((message) => message.kind)).toEqual(["setup", "update"]);

    root.publishEvent(event);
    expect(await next(iterator)).toEqual({ kind: "event", event });
    controller.abort();
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });

    const lateController = new AbortController();
    const late = root.messages(lateController.signal)[Symbol.asyncIterator]();
    expect((await next(late)).kind).toBe("setup");
    expect((await next(late)).kind).toBe("update");
    lateController.abort();
    await root.dispose();
  });
});

function StoreShow(props: StoreShowProps) {
  const color = useSyncExternalStore(props.store.subscribe, props.store.get);
  return (
    <Broadcast>
      <Sources>
        <ColorSource id="background" color={color} />
      </Sources>
      <Scene id="main" />
    </Broadcast>
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

function makeRoot(assets?: MakeRootAssets) {
  const layoutEngine: LayoutEngine = { layout: () => [] };
  return createComposerRoot(
    defineComposition({
      id: "settled",
      canvas: { width: 1280, height: 720 },
      component: () => null,
    }),
    { layoutEngine, ...omitUndefined({ assets: assets }) },
  );
}

async function next(iterator: AsyncIterator<RuntimeMessage>): Promise<RuntimeMessage> {
  const result = await iterator.next();
  if (result.done) throw new Error("Runtime message stream ended unexpectedly.");
  return result.value;
}
