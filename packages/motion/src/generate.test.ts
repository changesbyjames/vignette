import { describe, expect, it } from "vitest";

import { generateChunk, settleSeconds, type ChunkSpec, type Visual } from "./generate.js";
import { springPhysics } from "./index.js";

const at = (cx: number, cy: number, extra: Partial<Visual> = {}): Visual => ({
  cx,
  cy,
  w: 200,
  h: 100,
  rot: 0,
  op: 1,
  ...extra,
});

function spec(overrides: Partial<ChunkSpec> = {}): ChunkSpec {
  return {
    sceneName: "vignette/show/main",
    sceneItemId: 7,
    label: "test",
    to: at(960, 540),
    transition: { type: "spring", visualDuration: 0.5, bounce: 0.25 },
    ...overrides,
  };
}

/** The value of a `local NAME, ... = a, b` line in the chunk, for the given name. */
function constant(lua: string, name: string): string {
  for (const raw of lua.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("local ") || !line.includes(" = ")) continue;
    const names = line
      .slice(6, line.indexOf(" = "))
      .split(",")
      .map((n) => n.trim());
    const index = names.indexOf(name);
    if (index === -1) continue;
    // Values are split on top-level commas only; a table value keeps its own commas.
    const value = line.slice(line.indexOf(" = ") + 3).split(/, (?![^{]*})/)[index];
    if (value === undefined) throw new Error(`no value for ${name}`);
    return value.trim();
  }
  throw new Error(`no local ${name}`);
}

describe("generateChunk", () => {
  it("bakes the spring's physics as the undamped frequency and damping ratio", () => {
    const transition = { type: "spring", visualDuration: 0.5, bounce: 0.25 } as const;
    const lua = generateChunk(spec({ transition }));
    const { stiffness, damping, mass } = springPhysics(transition);
    expect(Number(constant(lua, "W0"))).toBeCloseTo(Math.sqrt(stiffness / mass), 4);
    expect(Number(constant(lua, "ZETA"))).toBeCloseTo(
      damping / (2 * Math.sqrt(stiffness * mass)),
      4,
    );
  });

  it("samples a tween's curve at 240 Hz, from 0 to 1, so the chunk only interpolates", () => {
    const lua = generateChunk(
      spec({ transition: { type: "tween", duration: 0.5, ease: "easeOut" } }),
    );
    const curve = constant(lua, "CURVE").replace(/[{}]/g, "").split(",").map(Number);
    expect(curve).toHaveLength(0.5 * 240 + 1);
    expect(curve[0]).toBe(0);
    expect(curve.at(-1)).toBe(1);
    expect(curve.every((value, index) => index === 0 || value >= (curve[index - 1] ?? 0))).toBe(
      true,
    );
    expect(constant(lua, "DURATION")).toBe("0.5");
  });

  it("bakes a start state only when one is given, else the chunk inherits or reads", () => {
    expect(constant(generateChunk(spec()), "FROM")).toBe("nil");
    expect(constant(generateChunk(spec({ from: at(100, 200) })), "FROM")).toContain("cx = 100");
  });

  it("names the opacity input only when the placement fades", () => {
    expect(constant(generateChunk(spec()), "FILTER_INPUT")).toBe('""');
    expect(
      constant(generateChunk(spec({ opacityInput: "vignette/show/logo" })), "FILTER_INPUT"),
    ).toBe('"vignette/show/logo"');
  });

  it("marks an exit to hide the item once settled", () => {
    expect(constant(generateChunk(spec()), "HIDE_AT_END")).toBe("false");
    expect(constant(generateChunk(spec({ hideAtEnd: true })), "HIDE_AT_END")).toBe("true");
  });

  it("is deterministic, so equal placements share one file", () => {
    expect(generateChunk(spec())).toBe(generateChunk(spec()));
    expect(generateChunk(spec())).not.toBe(generateChunk(spec({ to: at(1, 1) })));
  });
});

describe("settleSeconds", () => {
  it("is a tween's delay plus duration", () => {
    expect(settleSeconds({ type: "tween", duration: 0.4, delay: 0.1 })).toBeCloseTo(0.5);
  });

  it("gives a bouncier spring longer to settle, and never more than ten seconds", () => {
    const calm = settleSeconds({ type: "spring", visualDuration: 0.4, bounce: 0 });
    const bouncy = settleSeconds({ type: "spring", visualDuration: 0.4, bounce: 0.6 });
    expect(bouncy).toBeGreaterThan(calm);
    expect(settleSeconds({ type: "spring", stiffness: 1, damping: 0.01 })).toBe(10);
  });
});
