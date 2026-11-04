/**
 * Test doubles for the OBS side of motion: a Lua host (wasmoon, Lua in WebAssembly) with an
 * in-memory `obslua` that has the scene items, filters, settings and JSON files the loader and
 * the generated chunks use. Nothing here touches OBS or the disk: chunks and the loader run under
 * test, frame by frame, on any platform.
 *
 * @module
 */
import { LuaFactory, type LuaEngine } from "wasmoon";
import { z } from "zod";

import type { Visual } from "./generate.js";

/** One scene item as the fake OBS keeps it. */
export interface FakeSceneItem {
  readonly id: number;
  pos: Vec2;
  bounds: Vec2;
  rot: number;
  visible: boolean;
  /** Every value `obs_sceneitem_set_visible` was called with, in order. */
  readonly visibility: boolean[];
}

/** An `obslua` `vec2`, which Lua reads and writes by field. */
export interface Vec2 {
  x: number;
  y: number;
}

/** A filter's settings: what a chunk reads and updates. */
export type FilterSettings = Record<string, number>;

/** An input with filters whose settings chunks update. */
export interface FakeInput {
  readonly name: string;
  readonly filters: Map<string, FilterSettings>;
}

/** What the fake `obslua` holds; tests read and seed it directly. */
export interface FakeObs {
  readonly scenes: Map<string, Map<number, FakeSceneItem>>;
  readonly inputs: Map<string, FakeInput>;
  /** Lines the loader logged with `script_log`. */
  readonly log: string[];
  /** The fake file system `obs_data_create_from_json_file`, `obs_data_save_json_safe` and `loadfile` use. */
  readonly files: Map<string, string>;
}

/** A running chunk: what its `make(obs, inherited)` returned. */
export interface ChunkHandle {
  tick(dt: number): boolean;
  handoff(): HandoffState;
}

/** What a chunk hands its successor: position and velocity per dimension. */
export interface HandoffState {
  readonly pos: Visual;
  readonly vel: Visual;
}

/** One frame of a simulated chunk: the item's visual state after that frame's tick. */
export interface Frame {
  readonly t: number;
  readonly visual: Visual;
  readonly visible: boolean;
  readonly done: boolean;
}

/** Options of {@link LuaHost.simulate}. */
export interface SimulateOptions {
  readonly fps?: number;
  readonly maxSeconds?: number;
  /** Read opacity from this input's `vignette/opacity` filter. */
  readonly opacityInput?: string;
}

export interface LuaHost {
  readonly obs: FakeObs;
  readonly engine: LuaEngine;
  /** Adds a scene item at a visual state; returns it. */
  item(scene: string, id: number, visual: Visual, visible?: boolean): FakeSceneItem;
  /** Adds an input with an opacity filter at `opacity`. */
  input(name: string, opacity: number): FakeInput;
  /** Reads an item's visual state, with opacity from the named input's filter when given. */
  visual(scene: string, id: number, opacityInput?: string): Visual;
  /** Runs a generated chunk's Lua and starts it, with a predecessor's hand-off if given. */
  start(lua: string, inherited?: HandoffState): Promise<ChunkHandle>;
  /** Ticks a chunk at `fps` until it reports done or `maxSeconds` pass; returns every frame. */
  simulate(chunk: ChunkHandle, scene: string, id: number, options?: SimulateOptions): Frame[];
  /** Loads the loader script as OBS would, with `script_path()` at `dir` (trailing slash). */
  loadScript(lua: string, dir: string): Promise<void>;
  /** Calls the loaded script's `script_tick`. */
  scriptTick(dt: number): void;
  dispose(): void;
}

const factory = new LuaFactory();

/** A Lua host with an empty fake OBS. */
export async function createLuaHost(): Promise<LuaHost> {
  const engine = await factory.createEngine();
  const obs: FakeObs = { scenes: new Map(), inputs: new Map(), log: [], files: new Map() };
  engine.global.set("obslua", obsluaApi(obs));
  engine.global.set("__read_file", (path: string) => obs.files.get(path));
  // `loadfile` reads the fake file system, so chunk files never touch the disk.
  await engine.doString(`
    function loadfile(path)
      local source = __read_file(path)
      if source == nil then return nil, "cannot open " .. path end
      return load(source, "@" .. path)
    end
  `);

  const host: LuaHost = {
    obs,
    engine,
    item(scene, id, visual, visible = false) {
      const items = obs.scenes.get(scene) ?? new Map<number, FakeSceneItem>();
      obs.scenes.set(scene, items);
      const item: FakeSceneItem = {
        id,
        pos: { x: visual.cx - visual.w / 2, y: visual.cy - visual.h / 2 },
        bounds: { x: visual.w, y: visual.h },
        rot: visual.rot,
        visible,
        visibility: [],
      };
      items.set(id, item);
      return item;
    },
    input(name, opacity) {
      const input: FakeInput = { name, filters: new Map([["vignette/opacity", { opacity }]]) };
      obs.inputs.set(name, input);
      return input;
    },
    visual(scene, id, opacityInput) {
      const item = obs.scenes.get(scene)?.get(id);
      if (item === undefined) throw new Error(`no item ${String(id)} in ${scene}`);
      return visualOf(item, opacityOf(obs, opacityInput));
    },
    // The hand-off is optional; a false flag stands for "none", since nil cannot cross from JS.
    async start(lua, inherited) {
      engine.global.set("__inherited", inherited ?? false);
      const result: unknown = await engine.doString(`
        local make = (function() ${lua} end)()
        local inherited = __inherited
        if not inherited then return make(obslua, nil) end
        -- Copy the hand-off into Lua tables, as the loader would hold them.
        local function copy(v) return { cx = v.cx, cy = v.cy, w = v.w, h = v.h, rot = v.rot, op = v.op } end
        return make(obslua, { pos = copy(inherited.pos), vel = copy(inherited.vel) })
      `);
      // SAFETY: A chunk's factory returns the { tick, handoff } table (generateChunk contract); wasmoon converts it to an object with callable members.
      return result as ChunkHandle;
    },
    // Each option has a default, and the loop ends on `done` or the time limit.
    simulate(chunk, scene, id, options = {}) {
      const fps = options.fps ?? 60;
      const maxSeconds = options.maxSeconds ?? 10;
      const frames: Frame[] = [];
      let t = 0;
      while (t < maxSeconds) {
        // One frame per iteration; the item may be gone once a chunk releases it, hence the `??`.
        t += 1 / fps;
        const done = chunk.tick(1 / fps);
        const item = obs.scenes.get(scene)?.get(id);
        frames.push({
          t,
          visual: host.visual(scene, id, options.opacityInput),
          visible: item?.visible ?? false,
          done,
        });
        if (done) break;
      }
      return frames;
    },
    async loadScript(lua, dir) {
      engine.global.set("script_path", () => dir);
      await engine.doString(lua);
      await engine.doString("if script_load then script_load(nil) end");
    },
    scriptTick(dt) {
      // SAFETY: The loader defines `script_tick(seconds)` (loader contract); undefined only before loadScript.
      const tick = engine.global.get("script_tick") as ((dt: number) => void) | undefined;
      if (tick === undefined) throw new Error("no script loaded");
      tick(dt);
    },
    dispose() {
      engine.global.close();
    },
  };
  return host;
}

/** Centre, size, rotation and opacity from an item's position, bounds and rotation. */
function visualOf(item: FakeSceneItem, op: number): Visual {
  const a = (item.rot * Math.PI) / 180;
  const hx = item.bounds.x / 2;
  const hy = item.bounds.y / 2;
  return {
    cx: item.pos.x + hx * Math.cos(a) - hy * Math.sin(a),
    cy: item.pos.y + hx * Math.sin(a) + hy * Math.cos(a),
    w: item.bounds.x,
    h: item.bounds.y,
    rot: item.rot,
    op,
  };
}

/** The named input's filter opacity, or 1 when no input is named or it has no filter. */
function opacityOf(obs: FakeObs, input: string | undefined): number {
  if (input === undefined) return 1;
  return obs.inputs.get(input)?.filters.get("vignette/opacity")?.opacity ?? 1;
}

/** A handle to a scene or an input, by name. */
interface NamedSource {
  readonly kind: "scene" | "input";
  readonly name: string;
}

/** A handle to a filter on an input. */
interface FilterSource {
  readonly kind: "filter";
  readonly name: string;
  readonly input: string;
}

/** A source handle: a scene, an input, or a filter on an input. */
type SourceEntry = NamedSource | FilterSource;

/** A settings object (`obs_data_t`): what the loader reads from and writes to JSON. */
const SettingsSchema = z.record(z.string(), z.json());
type Settings = z.output<typeof SettingsSchema>;

/** `obs_data_t`, array, source and item handles, by number, as Lua passes them around. */
class Handles {
  private next = 1;
  private readonly settings = new Map<number, Settings>();
  private readonly arrays = new Map<number, readonly unknown[]>();
  private readonly sources = new Map<number, SourceEntry>();
  private readonly items = new Map<number, FakeSceneItem>();

  settingsOf(handle: number): Settings {
    return this.get(this.settings, handle, "obs_data");
  }
  arrayOf(handle: number): readonly unknown[] {
    return this.get(this.arrays, handle, "obs_data_array");
  }
  sourceOf(handle: number): SourceEntry {
    return this.get(this.sources, handle, "source");
  }
  itemOf(handle: number): FakeSceneItem {
    return this.get(this.items, handle, "scene item");
  }
  newSettings(value: Settings = {}): number {
    return this.create(this.settings, value);
  }
  newArray(value: readonly unknown[]): number {
    return this.create(this.arrays, value);
  }
  newSource(value: SourceEntry): number {
    return this.create(this.sources, value);
  }
  newItem(value: FakeSceneItem): number {
    return this.create(this.items, value);
  }
  private create<T>(store: Map<number, T>, value: T): number {
    const handle = this.next++;
    store.set(handle, value);
    return handle;
  }
  private get<T>(store: Map<number, T>, handle: number, what: string): T {
    const value = store.get(handle);
    if (value === undefined) throw new Error(`${what} ${String(handle)} is not live`);
    return value;
  }
}

/** The subset of `obslua` the loader and chunks call. */
function obsluaApi(obs: FakeObs) {
  const handles = new Handles();
  const filterOf = (handle: number): FilterSettings => {
    const entry = handles.sourceOf(handle);
    const filter =
      entry.kind === "filter" ? obs.inputs.get(entry.input)?.filters.get(entry.name) : undefined;
    if (filter === undefined) throw new Error("not a filter handle");
    return filter;
  };
  const sceneItems = (sceneHandle: number) => {
    const entry = handles.sourceOf(sceneHandle);
    return entry.kind === "scene" ? obs.scenes.get(entry.name) : undefined;
  };
  return {
    LOG_INFO: 300,
    script_log: (_level: number, message: string) => {
      obs.log.push(message);
    },
    // Sources, scenes and items.
    obs_get_source_by_name: (name: string) => {
      if (obs.scenes.has(name)) return handles.newSource({ kind: "scene", name });
      if (obs.inputs.has(name)) return handles.newSource({ kind: "input", name });
      return undefined;
    },
    obs_source_release: () => undefined,
    obs_scene_from_source: (handle: number) => handle,
    obs_scene_find_sceneitem_by_id: (sceneHandle: number, id: number) => {
      const item = sceneItems(sceneHandle)?.get(id);
      return item === undefined ? undefined : handles.newItem(item);
    },
    obs_sceneitem_addref: () => undefined,
    obs_sceneitem_release: () => undefined,
    obs_sceneitem_defer_update_begin: () => undefined,
    obs_sceneitem_defer_update_end: () => undefined,
    vec2: (): Vec2 => ({ x: 0, y: 0 }),
    obs_sceneitem_get_pos: (handle: number, out: Vec2) => {
      Object.assign(out, handles.itemOf(handle).pos);
    },
    obs_sceneitem_get_bounds: (handle: number, out: Vec2) => {
      Object.assign(out, handles.itemOf(handle).bounds);
    },
    obs_sceneitem_get_rot: (handle: number) => handles.itemOf(handle).rot,
    obs_sceneitem_set_pos: (handle: number, p: Vec2) => {
      handles.itemOf(handle).pos = { x: p.x, y: p.y };
    },
    obs_sceneitem_set_bounds: (handle: number, b: Vec2) => {
      handles.itemOf(handle).bounds = { x: b.x, y: b.y };
    },
    obs_sceneitem_set_rot: (handle: number, rot: number) => {
      handles.itemOf(handle).rot = rot;
    },
    obs_sceneitem_visible: (handle: number) => handles.itemOf(handle).visible,
    obs_sceneitem_set_visible: (handle: number, visible: boolean) => {
      const item = handles.itemOf(handle);
      item.visible = visible;
      item.visibility.push(visible);
    },
    // Filters and their settings.
    obs_source_get_filter_by_name: (inputHandle: number, name: string) => {
      const entry = handles.sourceOf(inputHandle);
      const input = entry.kind === "input" ? obs.inputs.get(entry.name) : undefined;
      if (input === undefined || !input.filters.has(name)) return undefined;
      return handles.newSource({ kind: "filter", name, input: input.name });
    },
    obs_source_get_settings: (handle: number) => handles.newSettings({ ...filterOf(handle) }),
    obs_source_update: (handle: number, settings: number) => {
      const filter = filterOf(handle);
      for (const [key, value] of Object.entries(handles.settingsOf(settings))) {
        filter[key] = z.number().parse(value);
      }
    },
    // obs_data: settings objects and JSON files.
    obs_data_create: () => handles.newSettings(),
    obs_data_release: () => undefined,
    obs_data_array_release: () => undefined,
    obs_data_get_double: (handle: number, key: string) =>
      z.number().catch(0).parse(handles.settingsOf(handle)[key]),
    obs_data_get_int: (handle: number, key: string) =>
      Math.trunc(z.number().catch(0).parse(handles.settingsOf(handle)[key])),
    obs_data_get_string: (handle: number, key: string) =>
      z.string().catch("").parse(handles.settingsOf(handle)[key]),
    obs_data_set_double: (handle: number, key: string, value: number) => {
      handles.settingsOf(handle)[key] = value;
    },
    obs_data_set_int: (handle: number, key: string, value: number) => {
      handles.settingsOf(handle)[key] = Math.trunc(value);
    },
    obs_data_set_string: (handle: number, key: string, value: string) => {
      handles.settingsOf(handle)[key] = value;
    },
    obs_data_get_array: (handle: number, key: string) => {
      const value = z.array(z.json()).safeParse(handles.settingsOf(handle)[key]);
      return value.success ? handles.newArray(value.data) : undefined;
    },
    obs_data_array_count: (handle: number) => handles.arrayOf(handle).length,
    obs_data_array_item: (handle: number, index: number) =>
      handles.newSettings(SettingsSchema.catch({}).parse(handles.arrayOf(handle)[index])),
    obs_data_create_from_json_file: (path: string) => {
      const text = obs.files.get(path);
      if (text === undefined) return undefined;
      const parsed = SettingsSchema.safeParse(JSON.parse(text));
      return parsed.success ? handles.newSettings(parsed.data) : undefined;
    },
    obs_data_save_json_safe: (handle: number, path: string) => {
      obs.files.set(path, JSON.stringify(handles.settingsOf(handle)));
      return true;
    },
  };
}
