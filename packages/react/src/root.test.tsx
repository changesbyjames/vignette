import {
  layerId,
  projectId,
  sceneId,
  sourceId,
  type ColorSource as ColorSourceDefinition,
  type CompiledSnapshot,
} from "@cbj/vignette-core";
import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Broadcast, ColorSource, Layer, Scene, Sources } from "./primitives.js";
import { createComposerRoot } from "./root.js";

describe("createComposerRoot", () => {
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
        colors.push((definition as ColorSourceDefinition).color);
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
          <Scene id={sceneId("main")}>
            <Layer id={layerId("missing-layer")} sourceId={sourceId("missing")} />
          </Scene>
        </Broadcast>,
      ),
    ).rejects.toThrow(/missing source/u);

    expect(root.getSnapshot()?.revision).toBe(first.compiledRevision);
    await root.dispose();
  });
});

function makeRoot() {
  return createComposerRoot({
    projectId: projectId("show"),
    canvas: { width: 1280, height: 720 },
  });
}

function show(color: string) {
  return (
    <Broadcast>
      <Sources>
        <ColorSource id={sourceId("background")} color={color} />
      </Sources>
      <Scene id={sceneId("main")}>
        <Layer
          id={layerId("background-layer")}
          sourceId={sourceId("background")}
          style={{ width: "100%", height: "100%" }}
        />
      </Scene>
    </Broadcast>
  );
}
