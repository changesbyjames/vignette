import { describe, expect, it } from "vitest";
import { z } from "zod";

import { generateChunk, type Visual } from "./generate.js";
import { LOADER_LUA, LOADER_VERSION } from "./loader.js";
import { createLuaHost, type LuaHost } from "./testing.js";

const DIR = "/fake/motion/";
const SCENE = "vignette/show/main";
const at = (cx: number): Visual => ({ cx, cy: 100, w: 200, h: 100, rot: 0, op: 1 });

/** What the loader writes to `state.json`. */
const StateSchema = z.object({
  loader: z.string(),
  ack_seq: z.number(),
  loads: z.number(),
  handoffs: z.number(),
  errors: z.number(),
  live: z.number(),
  done: z.string(),
  last_error: z.string(),
});
type State = z.output<typeof StateSchema>;

/** A chunk file and the command naming it, as the plugin would write them. */
interface Load {
  readonly key: string;
  readonly lua: string;
}

/** A host with the loader script loaded, as OBS would load it from `DIR`. */
async function withLoader(run: (loader: Loader) => void | Promise<void>): Promise<void> {
  const host = await createLuaHost();
  try {
    await host.loadScript(LOADER_LUA, DIR);
    await run(new Loader(host));
  } finally {
    host.dispose();
  }
}

/** The loader under test: its files and the item it moves, through the fake OBS. */
class Loader {
  constructor(readonly host: LuaHost) {}

  state(): State {
    const text = this.host.obs.files.get(`${DIR}state.json`);
    if (text === undefined) throw new Error("no state.json");
    return StateSchema.parse(JSON.parse(text));
  }

  /** Writes the chunk files into the fake file system and a command loading them. */
  command(seq: number, loads: readonly Load[]): void {
    const load = loads.map(({ key, lua }, i) => {
      const path = `${DIR}chunks/${String(seq)}-${String(i)}.lua`;
      this.host.obs.files.set(path, lua);
      return { key, path };
    });
    this.host.obs.files.set(`${DIR}commands.json`, JSON.stringify({ seq, load }));
  }

  frames(count: number): void {
    for (let i = 0; i < count; i++) this.host.scriptTick(1 / 60);
  }

  x(id = 1): number {
    return this.host.visual(SCENE, id).cx;
  }
}

/** A chunk moving the item towards `cx` with a soft, critically damped spring. */
const toward = (cx: number, sceneItemId = 1): string =>
  generateChunk({
    sceneName: SCENE,
    sceneItemId,
    label: "test",
    to: at(cx),
    transition: { type: "spring", visualDuration: 1, bounce: 0 },
  });

describe("the loader", () => {
  it("reports its version at load, before any command", () =>
    withLoader((loader) => {
      expect(loader.state()).toMatchObject({ loader: LOADER_VERSION, ack_seq: -1, live: 0 });
    }));

  it("loads the chunks a command names, acknowledges the sequence, and runs them each frame", () =>
    withLoader((loader) => {
      loader.host.item(SCENE, 1, at(0));
      loader.command(5, [{ key: "main:box", lua: toward(600) }]);
      loader.frames(1);
      expect(loader.state()).toMatchObject({ ack_seq: 5, loads: 1, live: 1, errors: 0 });
      const first = loader.x();
      expect(first).toBeGreaterThan(0);
      loader.frames(1);
      expect(loader.x()).toBeGreaterThan(first);
    }));

  it("ignores a command it has already applied", () =>
    withLoader((loader) => {
      loader.host.item(SCENE, 1, at(0));
      loader.command(5, [{ key: "main:box", lua: toward(600) }]);
      loader.frames(2);
      expect(loader.state().loads).toBe(1);
    }));

  it("replaces a key's chunk with the next one, handing the state over", () =>
    withLoader((loader) => {
      loader.host.item(SCENE, 1, at(0));
      loader.command(1, [{ key: "main:box", lua: toward(600) }]);
      loader.frames(10);
      const before = loader.x();
      loader.command(2, [{ key: "main:box", lua: toward(-600) }]);
      loader.frames(1);
      expect(loader.state()).toMatchObject({ ack_seq: 2, loads: 2, handoffs: 1, live: 1 });
      // The replacement starts where its predecessor was, still moving right: no jump back.
      expect(loader.x()).toBeGreaterThan(before);
      expect(loader.x() - before).toBeLessThan((2 * before) / 10);
    }));

  it("drops a finished chunk and names its key as done", () =>
    withLoader((loader) => {
      loader.host.item(SCENE, 1, at(0));
      loader.command(1, [{ key: "main:box", lua: toward(600) }]);
      loader.frames(240);
      expect(loader.state()).toMatchObject({ live: 0, done: "main:box" });
      expect(loader.x()).toBe(600);
    }));

  it("records a chunk that fails to start, and keeps running the others", () =>
    withLoader((loader) => {
      loader.host.item(SCENE, 1, at(0));
      loader.command(1, [
        { key: "main:missing", lua: toward(600, 99) },
        { key: "main:box", lua: toward(600) },
      ]);
      loader.frames(1);
      expect(loader.state()).toMatchObject({ errors: 1, loads: 1, live: 1 });
      expect(loader.state().last_error).toMatch(/no item 99/);
      expect(loader.host.obs.log.some((line) => line.includes("no item 99"))).toBe(true);
    }));

  it("records a chunk file that is missing or does not parse", () =>
    withLoader((loader) => {
      const files = loader.host.obs.files;
      const command = (seq: number, path: string) =>
        files.set(`${DIR}commands.json`, JSON.stringify({ seq, load: [{ key: "a", path }] }));
      command(1, `${DIR}chunks/none.lua`);
      loader.frames(1);
      expect(loader.state()).toMatchObject({ errors: 1, loads: 0 });
      files.set(`${DIR}chunks/bad.lua`, "return function( --");
      command(2, `${DIR}chunks/bad.lua`);
      loader.frames(1);
      expect(loader.state()).toMatchObject({ errors: 2, loads: 0, ack_seq: 2 });
    }));

  it("runs several keys at once, each on its own item", () =>
    withLoader((loader) => {
      loader.host.item(SCENE, 1, at(0));
      loader.host.item(SCENE, 2, at(0));
      loader.command(1, [
        { key: "main:a", lua: toward(600) },
        { key: "main:b", lua: toward(300, 2) },
      ]);
      loader.frames(240);
      expect(loader.x(1)).toBe(600);
      expect(loader.x(2)).toBe(300);
      expect(loader.state().done.split(",").sort()).toEqual(["main:a", "main:b"]);
    }));
});
