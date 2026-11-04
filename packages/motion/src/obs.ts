/**
 * The `motion` kind for `@strangecyan/vignette/obs`. Each placement becomes a generated Lua
 * chunk, run inside OBS by the one hand-installed loader script, so motion is locked to OBS's
 * video frames rather than paced over the websocket. Without the loader, items are placed at
 * rest, so the show still works.
 *
 * @module
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Item } from "@strangecyan/vignette";
import type { ObsLayerPlugin, ObsPlacementContext } from "@strangecyan/vignette/obs";
import { z } from "zod";

import { generateChunk, settleSeconds, type Visual } from "./generate.js";
import {
  DEFAULT_TRANSITION,
  MotionLayer,
  motionOf,
  type MotionProps,
  type MotionValues,
  type Transition,
} from "./index.js";
import { LOADER_LUA, LOADER_VERSION } from "./loader.js";

/** One loader directory: its command sequence and whether the loader answered. */
interface Mailbox {
  seq: number;
  installed?: boolean;
}
const mailboxes = new Map<string, Mailbox>();

const OPACITY_FILTER = "vignette/opacity";

export const motionObsLayer: ObsLayerPlugin<typeof MotionLayer> = {
  kind: MotionLayer.definition.kind,

  // Enter and retarget share one path: the only differences are the label and the start state.
  async place(item, context) {
    const motion = motionOf(item) ?? {};
    const rest = restVisual(context);
    await prepareItem(item, motion, context);
    const from = startVisual(motion, rest, context.previous);
    await run(context, {
      label: context.previous === undefined ? "enter" : "retarget",
      from,
      to: apply(rest, motion.animate ?? {}),
      transition: motion.transition ?? DEFAULT_TRANSITION,
      item,
      wait: false,
      fallback: () => placeAtRest(item, context),
    });
  },

  async remove(item, context) {
    const motion = motionOf(item) ?? {};
    if (motion.exit === undefined) return;
    await run(context, {
      label: "exit",
      to: apply(restVisual(context), motion.exit),
      transition: motion.transition ?? DEFAULT_TRANSITION,
      hideAtEnd: true,
      item,
      wait: true,
      fallback: () => Promise.resolve(),
    });
  },
};

/** A new item starts at `initial` (unless `false`); a re-placed one continues from its chunk. */
function startVisual(
  motion: MotionProps,
  rest: Visual,
  previous: Item | undefined,
): Visual | undefined {
  if (previous !== undefined || motion.initial === false) return undefined;
  return apply(rest, motion.initial ?? {});
}

/** What a plain layer would get: the loader is missing, so the item just sits at rest. */
async function placeAtRest(item: Item, context: ObsPlacementContext): Promise<void> {
  await context.call("SetSceneItemTransform", {
    sceneName: context.sceneName,
    sceneItemId: context.sceneItemId,
    sceneItemTransform: context.transform,
  });
  await context.call("SetSceneItemEnabled", {
    sceneName: context.sceneName,
    sceneItemId: context.sceneItemId,
    sceneItemEnabled: item.visible,
  });
}

interface Run {
  readonly label: string;
  readonly from?: Visual;
  readonly to: Visual;
  readonly transition: Transition;
  readonly hideAtEnd?: boolean;
  readonly item: Item;
  /** Resolve only once the chunk has settled (an exit), not once the loader has it. */
  readonly wait: boolean;
  /** What to do when the loader is not installed. */
  readonly fallback: () => Promise<void>;
}

/** Writes the chunk and hands it to the loader; runs the fallback when the loader is absent. */
async function run(context: ObsPlacementContext, spec: Run): Promise<void> {
  const dir = await context.directory();
  const mailbox = mailboxes.get(dir) ?? { seq: Date.now() % 1_000_000_000 };
  mailboxes.set(dir, mailbox);
  await ensureLoader(dir);
  const path = await writeChunk(dir, context, spec);
  const key = `${context.sceneId}:${spec.item.id}`;
  mailbox.seq += 1;
  const seq = mailbox.seq;
  const command = { seq, load: [{ key, path: path.replaceAll("\\", "/") }] };
  await writeAtomic(join(dir, "commands.json"), JSON.stringify(command));
  // A loader known to be missing gets a short wait, so every placement is not slowed by it.
  const patience = mailbox.installed === false ? 300 : 2_000;
  const acked = await waitForState(dir, (state) => state.ack_seq >= seq, patience);
  if (!acked) {
    if (mailbox.installed !== false) warnMissingLoader(dir);
    mailbox.installed = false;
    await spec.fallback();
    return;
  }
  mailbox.installed = true;
  if (!spec.wait) return;
  const budget = settleSeconds(spec.transition) * 1_000 + 1_500;
  await waitForState(dir, (state) => state.done.split(",").includes(key), budget);
}

async function writeChunk(dir: string, context: ObsPlacementContext, spec: Run): Promise<string> {
  const lua = generateChunk({
    sceneName: context.sceneName,
    sceneItemId: context.sceneItemId,
    opacityInput: fades(spec.item, motionOf(spec.item)) ? inputName(context) : undefined,
    label: spec.label,
    from: spec.from,
    to: spec.to,
    transition: spec.transition,
    hideAtEnd: spec.hideAtEnd,
  });
  const chunks = join(dir, "chunks");
  await mkdir(chunks, { recursive: true });
  const path = join(chunks, `${createHash("sha256").update(lua).digest("hex").slice(0, 16)}.lua`);
  await writeFile(path, lua);
  return path;
}

function warnMissingLoader(dir: string): void {
  console.warn(
    `@strangecyan/vignette-motion: no motion loader in OBS; placing layers at rest. Add ${join(dir, "loader.lua")} under Tools > Scripts in OBS.`,
  );
}

/** Centre, size, rotation and opacity of the rest state, from the planner's transform. */
function restVisual(context: ObsPlacementContext): Visual {
  const t = context.transform;
  const a = (t.rotation * Math.PI) / 180;
  const hx = t.boundsWidth / 2;
  const hy = t.boundsHeight / 2;
  return {
    cx: t.positionX + hx * Math.cos(a) - hy * Math.sin(a),
    cy: t.positionY + hx * Math.sin(a) + hy * Math.cos(a),
    w: t.boundsWidth,
    h: t.boundsHeight,
    rot: t.rotation,
    op: 1,
  };
}

/** Motion values applied as offsets on a rest state. */
function apply(rest: Visual, values: MotionValues): Visual {
  const scale = values.scale ?? 1;
  return {
    cx: rest.cx + (values.x ?? 0),
    cy: rest.cy + (values.y ?? 0),
    w: rest.w * scale,
    h: rest.h * scale,
    rot: rest.rot + (values.rotate ?? 0),
    op: rest.op * (values.opacity ?? 1),
  };
}

/** Whether any state fades; then the source carries an opacity filter. */
function fades(item: Item, motion: MotionProps | undefined): boolean {
  const states = [motion?.initial, motion?.animate, motion?.exit];
  return (
    item.opacity !== 1 ||
    states.some((state) => state !== undefined && state !== false && state.opacity !== undefined)
  );
}

const FilterListSchema = z.object({
  filters: z.array(z.object({ filterName: z.string() })),
});
type FilterList = z.output<typeof FilterListSchema>;

/**
 * Sets what the chunk never touches: the crop and bounds mode from the rest transform, and the
 * opacity filter if the layer fades. OBS has no per-item opacity: the filter is on the source,
 * so a shared source fades everywhere it is placed.
 */
async function prepareItem(
  item: Item,
  motion: MotionProps,
  context: ObsPlacementContext,
): Promise<void> {
  if (context.previous === undefined) {
    const t = context.transform;
    await context.call("SetSceneItemTransform", {
      sceneName: context.sceneName,
      sceneItemId: context.sceneItemId,
      sceneItemTransform: {
        alignment: t.alignment,
        boundsType: t.boundsType,
        boundsAlignment: t.boundsAlignment,
        cropTop: t.cropTop,
        cropRight: t.cropRight,
        cropBottom: t.cropBottom,
        cropLeft: t.cropLeft,
      },
    });
  }
  if (!fades(item, motion)) return;
  const sourceName = inputName(context);
  const list: FilterList = FilterListSchema.parse(
    await context.call("GetSourceFilterList", { sourceName }),
  );
  if (list.filters.some((filter) => filter.filterName === OPACITY_FILTER)) return;
  await context.call("CreateSourceFilter", {
    sourceName,
    filterName: OPACITY_FILTER,
    filterKind: "color_filter_v2",
    filterSettings: { opacity: item.opacity },
  });
}

/** The managed input's name: the target's naming, reproduced from the scene name's prefix. */
function inputName(context: ObsPlacementContext): string {
  const prefix = context.sceneName.slice(0, context.sceneName.lastIndexOf("/"));
  return `${prefix}/${context.source.id}`;
}

async function ensureLoader(dir: string): Promise<void> {
  const path = join(dir, "loader.lua");
  const current = await readFile(path, "utf8").catch(() => undefined);
  if (current !== LOADER_LUA) await writeFile(path, LOADER_LUA);
}

/**
 * Writes the file in one step. The loader reads it every frame, and on Windows a file being read
 * cannot be replaced, so the rename is retried for a few frames.
 */
async function writeAtomic(path: string, text: string): Promise<void> {
  await writeFile(`${path}.tmp`, text);
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(`${path}.tmp`, path);
      return;
    } catch (error) {
      if (attempt >= 50) throw error;
      await new Promise((resolve) => setTimeout(resolve, 4));
    }
  }
}

/** What the loader writes to `state.json`. */
const LoaderStateSchema = z.object({
  loader: z.string(),
  ack_seq: z.number(),
  done: z.string(),
});
type LoaderState = z.output<typeof LoaderStateSchema>;

/** Polls `state.json` until `test` holds or `timeoutMs` passes; false on timeout. */
async function waitForState(
  dir: string,
  test: (state: LoaderState) => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  const path = join(dir, "state.json");
  while (Date.now() < end) {
    const state = await readState(path);
    if (state?.loader === LOADER_VERSION && test(state)) return true;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  return false;
}

/** The loader's state, or undefined while the file is missing or half-written. */
async function readState(path: string): Promise<LoaderState | undefined> {
  const text = await readFile(path, "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  try {
    return LoaderStateSchema.parse(JSON.parse(text));
  } catch {
    return undefined;
  }
}
