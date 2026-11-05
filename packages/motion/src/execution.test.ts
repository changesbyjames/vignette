import { describe, expect, it } from "vitest";

import { generateChunk, settleSeconds, type ChunkSpec, type Visual } from "./generate.js";
import type { Transition } from "./index.js";
import { createLuaHost, type Frame, type LuaHost } from "./testing.js";

const SCENE = "vignette/show/main";
const ITEM = 3;
const LOGO = "vignette/show/logo";

const at = (cx: number, cy: number, extra: Partial<Visual> = {}): Visual => ({
  cx,
  cy,
  w: 200,
  h: 100,
  rot: 0,
  op: 1,
  ...extra,
});

const SPRING: Transition = { type: "spring", visualDuration: 0.5, bounce: 0.25 };
/** Soft enough that one frame's acceleration is small next to the speed it has built up. */
const SOFT_SPRING: Transition = { type: "spring", visualDuration: 2, bounce: 0 };
const TWEEN: Transition = { type: "tween", duration: 0.6, ease: "easeOut" };

function chunk(overrides: Partial<ChunkSpec> = {}): string {
  return generateChunk({
    sceneName: SCENE,
    sceneItemId: ITEM,
    label: "test",
    to: at(1000, 500),
    transition: SPRING,
    ...overrides,
  });
}

/** Horizontal speed per frame between consecutive frames. */
function speeds(frames: readonly Frame[]): number[] {
  return frames.slice(1).map((frame, i) => frame.visual.cx - (frames[i]?.visual.cx ?? 0));
}

// Runs a test with its own Lua host, disposed afterwards whatever happens.
async function withHost(run: (host: LuaHost) => Promise<void>): Promise<void> {
  const host = await createLuaHost();
  try {
    await run(host);
  } finally {
    host.dispose();
  }
}

describe("a chunk", () => {
  it("starts at `from` before its first frame, and shows the item only after writing it", () =>
    withHost(async (host) => {
      // The `?.` chains below only guard the optional lookups; every one is expected to hit.
      host.item(SCENE, ITEM, at(0, 0));
      const running = await host.start(chunk({ from: at(100, 200) }));
      expect(host.visual(SCENE, ITEM)).toEqual(at(100, 200));
      expect(host.obs.scenes.get(SCENE)?.get(ITEM)?.visible).toBe(false);

      const [first] = host.simulate(running, SCENE, ITEM, { maxSeconds: 1 / 60 });
      expect(first?.visible).toBe(true);
      expect(first?.visual.cx).toBeGreaterThan(100);
      expect(first?.visual.cx).toBeLessThan(1000);
    }));

  it("shows a new item at its target when it starts there (`initial={false}`), never where OBS put it", () =>
    withHost(async (host) => {
      // OBS creates an item at its own default place and size; the chunk must not start from it.
      host.item(SCENE, ITEM, at(10, 10, { w: 40, h: 20 }));
      const running = await host.start(chunk({ from: at(1000, 500), to: at(1000, 500) }));
      const frames = host.simulate(running, SCENE, ITEM);
      expect(frames.every((frame) => frame.visual.cx === 1000 && frame.visual.w === 200)).toBe(
        true,
      );
      expect(frames[0]?.visible).toBe(true);
    }));

  it("settles exactly on its target within the settle time, and reports done once", () =>
    withHost(async (host) => {
      host.item(SCENE, ITEM, at(100, 200));
      const frames = host.simulate(await host.start(chunk()), SCENE, ITEM);
      const last = frames.at(-1);
      expect(last?.done).toBe(true);
      expect(frames.filter((frame) => frame.done)).toHaveLength(1);
      expect(last?.visual).toEqual(at(1000, 500));
      expect(last?.t).toBeLessThan(settleSeconds(SPRING));
    }));

  it("reads the item as its start when it has neither `from` nor a predecessor", () =>
    withHost(async (host) => {
      host.item(SCENE, ITEM, at(400, 300));
      const running = await host.start(chunk());
      const [first] = host.simulate(running, SCENE, ITEM, { maxSeconds: 1 / 60 });
      expect(first?.visual.cx).toBeGreaterThan(400);
      expect(first?.visual.cx).toBeLessThan(430);
    }));

  it("moves a linear tween at a constant speed", () =>
    withHost(async (host) => {
      host.item(SCENE, ITEM, at(0, 0));
      const transition: Transition = { type: "tween", duration: 1, ease: "linear" };
      const running = await host.start(chunk({ transition, to: at(600, 0) }));
      const frames = host.simulate(running, SCENE, ITEM);
      expect(frames).toHaveLength(60);
      const steps = speeds(frames).slice(0, -1);
      expect(steps.every((step) => Math.abs(step - 10) < 0.01)).toBe(true);
    }));

  it("hides an exiting item once settled, and never shows it", () =>
    withHost(async (host) => {
      const item = host.item(SCENE, ITEM, at(100, 100), true);
      const frames = host.simulate(await host.start(chunk({ hideAtEnd: true })), SCENE, ITEM);
      expect(frames.slice(0, -1).every((frame) => frame.visible)).toBe(true);
      expect(item.visible).toBe(false);
      expect(item.visibility).toEqual([false]);
    }));

  it("drives opacity through the input's filter, and leaves it alone otherwise", () =>
    withHost(async (host) => {
      host.item(SCENE, ITEM, at(100, 100));
      host.input(LOGO, 1);
      const fade = chunk({ opacityInput: LOGO, to: at(100, 100, { op: 0 }) });
      const frames = host.simulate(await host.start(fade), SCENE, ITEM, { opacityInput: LOGO });
      expect(frames.at(-1)?.visual.op).toBe(0);
      expect(frames.some((frame) => frame.visual.op > 0 && frame.visual.op < 1)).toBe(true);

      host.input(LOGO, 1);
      host.simulate(await host.start(chunk({ to: at(100, 100, { op: 0 }) })), SCENE, ITEM);
      expect(host.obs.inputs.get(LOGO)?.filters.get("vignette/opacity")).toEqual({ opacity: 1 });
    }));

  it("fails to start when the item is not in the scene", () =>
    withHost(async (host) => {
      host.item(SCENE, 9, at(0, 0));
      await expect(host.start(chunk())).rejects.toThrow(/no item 3/);
    }));
});

describe("hand-off between chunks", () => {
  /** What a retarget 12 frames into a motion looks like, with or without the hand-off. */
  interface Retarget {
    readonly before: readonly Frame[];
    readonly after: readonly Frame[];
    /** The change of speed across the join, in pixels per frame. */
    readonly step: number;
  }

  /** Moves towards x = 1000, then 12 frames in retargets further, to x = 1600. */
  async function retarget(transition: Transition, withHandoff: boolean): Promise<Retarget> {
    const host = await createLuaHost();
    try {
      host.item(SCENE, ITEM, at(0, 0));
      const first = await host.start(chunk({ transition, to: at(1000, 0) }));
      const before = host.simulate(first, SCENE, ITEM, { maxSeconds: 12 / 60 });
      const state = withHandoff ? first.handoff() : undefined;
      const second = await host.start(chunk({ transition, to: at(1600, 0) }), state);
      const after = host.simulate(second, SCENE, ITEM);
      // speeds[i] is the move from frame i to i + 1, so the join is at before.length - 1.
      const trajectory = speeds([...before, ...after]);
      const across = trajectory[before.length - 1] ?? 0;
      const last = trajectory[before.length - 2] ?? 0;
      return { before, after, step: Math.abs(across - last) };
    } finally {
      host.dispose();
    }
  }

  it.each([
    ["spring", SOFT_SPRING],
    ["tween", TWEEN],
  ])(
    "continues a %s retargeted mid-flight: the speed carries over, so there is no kink",
    async (_, transition) => {
      const continued = await retarget(transition, true);
      expect(continued.after.at(-1)?.visual.cx).toBe(1600);
      // Without the hand-off the new chunk starts from rest, and the speed it had is lost.
      const restarted = await retarget(transition, false);
      expect(continued.step).toBeLessThan(restarted.step / 4);
    },
  );

  it("hands over the state after the last frame it wrote", () =>
    withHost(async (host) => {
      host.item(SCENE, ITEM, at(0, 0));
      const running = await host.start(chunk({ to: at(1000, 0) }));
      const frames = host.simulate(running, SCENE, ITEM, { maxSeconds: 5 / 60 });
      const state = running.handoff();
      expect(state.pos.cx).toBeCloseTo(frames.at(-1)?.visual.cx ?? Number.NaN, 3);
      expect(state.vel.cx).toBeGreaterThan(0);
      expect(state.vel.cy).toBe(0);
    }));
});
