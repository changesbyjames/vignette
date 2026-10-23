import type {
  ColorSource as ColorSourceDefinition,
  CompiledSnapshot,
  LayoutEngine,
  StreamMessage,
  SourceModule,
} from "@strangecyan/vignette-core";
import { Activity, useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { defineComposition } from "./composition.js";
import { fill } from "./presets.js";
import { Box, Broadcast, ColorSource, Layer, Scene, Sources } from "./primitives.js";
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

  it("keeps a hidden Activity subtree declared and flips only visibility when revealed", async () => {
    const root = makeRoot();

    await root.render(<PrewarmShow mode="hidden" />);
    // React prerenders a newly mounted hidden Activity at idle priority, after the visible commit.
    const hidden = await vi.waitFor(() => {
      const snapshot = root.snapshot;
      if (!snapshot?.scenes.some((scene) => scene.id === "next")) {
        throw new Error("The hidden Activity has not prerendered yet.");
      }
      return snapshot;
    });
    await root.render(<PrewarmShow mode="visible" />);
    const visible = await root.settled();

    expect(hidden.sources.map((source) => source.id)).toEqual(["background", "next", "next-pin"]);
    expect(visible.sources).toEqual(hidden.sources);
    const hiddenNext = hidden.scenes.find((scene) => scene.id === "next");
    const visibleNext = visible.scenes.find((scene) => scene.id === "next");
    expect(hiddenNext?.items.map((item) => [item.id, item.visible])).toEqual([
      ["next-background", false],
      ["next-pinned", false],
    ]);
    expect(visibleNext?.items.map((item) => [item.id, item.visible])).toEqual([
      ["next-background", true],
      ["next-pinned", true],
    ]);
    expect(visibleNext?.items.map((item) => ({ ...item, visible: false }))).toEqual(
      hiddenNext?.items,
    );
    expect(hidden.scenes.find((scene) => scene.id === "main")?.items[0]?.visible).toBe(true);
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

interface PrewarmShowProps {
  readonly mode: "hidden" | "visible";
}

function PrewarmShow(props: PrewarmShowProps) {
  return (
    <Broadcast>
      <Sources>
        <ColorSource id="background" color="#000000" />
      </Sources>
      <Scene id="main">
        <Layer id="background-layer" sourceId="background" style={fill} />
      </Scene>
      <Activity mode={props.mode}>
        <Sources>
          <ColorSource id="next" color="#ffffff" />
          <ColorSource id="next-pin" color="#ff0000" size={{ width: 200, height: 100 }} />
        </Sources>
        <Scene id="next">
          <Box style={fill}>
            <Layer id="next-background" sourceId="next" style={fill} />
            <Layer id="next-pinned" sourceId="next-pin" style={fill} visible />
          </Box>
        </Scene>
      </Activity>
    </Broadcast>
  );
}
