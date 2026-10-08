import type {
  ColorSource as ColorSourceDefinition,
  CompiledSnapshot,
  LayoutEngine,
  StreamMessage,
  SourceModule,
} from "@strangecyan/vignette-core";
import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { defineComposition } from "./composition.js";
import { fill } from "./presets.js";
import { Broadcast, ColorSource, Layer, Scene, Sources } from "./primitives.js";
import { compile, createComposerRoot } from "./root.js";

describe("createComposerRoot", () => {
  it("uses a supplied layout engine without requiring the default Yoga binding", async () => {
    const layout = vi.fn<LayoutEngine["layout"]>((nodes, canvas) =>
      nodes.map((node, index) => ({
        node,
        frame: { x: 0, y: 0, width: canvas.width, height: canvas.height },
        path: `children[${String(index)}]`,
        children: [],
      })),
    );
    const root = createComposerRoot(
      defineComposition({
        id: "injected-layout",
        canvas: { width: 640, height: 360 },
        component: () => show("#112233"),
      }),
      { layoutEngine: { layout } },
    );

    await root.render();

    expect(layout).toHaveBeenCalledOnce();
    expect(root.snapshot?.scenes[0]?.items[0]?.frame).toEqual({
      x: 0,
      y: 0,
      width: 640,
      height: 360,
    });
    await root.dispose();
  });

  it("renders the composition's component and advertises its identity and extensions", async () => {
    const custom: SourceModule = {
      kind: "source:custom",
      entrypoints: { dom: "custom/dom", obs: "custom/obs" },
      intrinsicSize: () => undefined,
    };
    const composition = defineComposition({
      id: "defined-show",
      canvas: { width: 1280, height: 720 },
      extensions: [custom],
      component: () => show("#445566"),
    });
    const root = createComposerRoot(composition);

    const receipt = await root.render();

    expect(Object.isFrozen(composition)).toBe(true);
    expect(root.snapshot).toMatchObject({
      revision: receipt.compiledRevision,
      projectId: "defined-show",
      sources: [{ definition: { color: "#445566" } }],
    });
    const controller = new AbortController();
    const iterator = root.messages(controller.signal)[Symbol.asyncIterator]();
    const setup: IteratorResult<StreamMessage> = await iterator.next();
    expect(setup.value).toEqual({
      kind: "setup",
      projectId: "defined-show",
      manifest: { version: 1, assets: [] },
      extensions: [
        { kind: "source:custom", entrypoints: { dom: "custom/dom", obs: "custom/obs" } },
      ],
    });
    controller.abort();
    await root.dispose();
  });

  it("compiles one neutral snapshot and replays it to late subscribers", async () => {
    const root = makeRoot();
    await root.render(show("#112233"));

    const snapshots: CompiledSnapshot[] = [];
    root.subscribe((snapshot) => snapshots.push(snapshot));

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.scenes[0]?.items[0]?.frame).toEqual({
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
    });
    await root.dispose();
  });

  it("publishes snapshots for state updates originating inside the Node React tree", async () => {
    vi.useFakeTimers();
    const root = makeRoot();
    const colors: string[] = [];
    root.subscribe((snapshot) => {
      const definition = snapshot.sources[0]?.definition;
      if (definition?.kind === "source:color") {
        colors.push(
          /* SAFETY: This fixture or kind-selected source factory supplies the complete built-in definition inspected here. */ (
            definition as ColorSourceDefinition
          ).color,
        );
      }
    });

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
      return show(tick % 2 === 0 ? "#111111" : "#222222");
    }

    await root.render(<TimerShow />);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(colors).toEqual(["#111111", "#222222"]);
    });

    await root.dispose();
    vi.useRealTimers();
  });

  it("keeps the last valid snapshot when a later composition is invalid", async () => {
    const root = makeRoot();
    const first = await root.render(show("#111111"));

    await expect(
      root.render(
        <Broadcast>
          <Scene id="main">
            <Layer id="missing-layer" sourceId="missing" />
          </Scene>
        </Broadcast>,
      ),
    ).rejects.toThrow(/missing source/u);

    expect(root.snapshot?.revision).toBe(first.compiledRevision);
    await root.dispose();
  });

  it("resolves render with the compiled snapshot", async () => {
    const root = makeRoot();

    const receipt = await root.render(show("#123456"));

    expect(receipt.snapshot).toBe(root.snapshot);
    expect(receipt.snapshot.revision).toBe(receipt.compiledRevision);
    await root.dispose();
  });
});

describe("compile", () => {
  it("renders a composition once and resolves to its snapshot", async () => {
    function OneShotShow() {
      return (
        <Broadcast>
          <Sources>
            <ColorSource id="background" color="#222222" />
          </Sources>
          <Scene id="main">
            <Layer id="background-layer" sourceId="background" style={fill} />
          </Scene>
        </Broadcast>
      );
    }

    const snapshot = await compile(
      defineComposition({
        id: "one-shot",
        canvas: { width: 640, height: 360 },
        component: OneShotShow,
      }),
    );

    expect(snapshot.projectId).toBe("one-shot");
    expect(snapshot.sources[0]?.definition).toMatchObject({
      color: "#222222",
      size: { width: 640, height: 360 },
    });
    expect(snapshot.scenes[0]?.items[0]?.frame).toEqual({ x: 0, y: 0, width: 640, height: 360 });
  });

  it("rejects when the composition fails to compile", async () => {
    const composition = defineComposition({
      id: "broken",
      canvas: { width: 640, height: 360 },
      component: () => (
        <Broadcast>
          <Scene id="main">
            <Layer id="missing-layer" sourceId="missing" />
          </Scene>
        </Broadcast>
      ),
    });

    await expect(compile(composition)).rejects.toThrow(/missing source/u);
  });
});

function makeRoot() {
  return createComposerRoot(
    defineComposition({
      id: "show",
      canvas: { width: 1280, height: 720 },
      component: () => show("#000000"),
    }),
  );
}

function show(color: string) {
  return (
    <Broadcast>
      <Sources>
        <ColorSource id="background" color={color} />
      </Sources>
      <Scene id="main">
        <Layer
          id="background-layer"
          sourceId="background"
          style={{ width: "100%", height: "100%" }}
        />
      </Scene>
    </Broadcast>
  );
}
