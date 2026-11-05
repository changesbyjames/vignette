/**
 * The `motion` kind for `@strangecyan/vignette/obs`. Each placement becomes a generated Lua
 * chunk, run inside OBS by the one hand-installed loader script, so motion is locked to OBS's
 * video frames rather than paced over the websocket. Commands reach the loader through a mailbox
 * input the plugin owns (`vignette/<show>/motion/mailbox`): one `SetInputSettings` per command,
 * which fires the signal the loader listens for, and the loader answers in the same settings.
 * Without the loader, items are placed at rest, so the show still works.
 *
 * @module
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Item } from "@strangecyan/vignette";
import type { ObsLayerContext, ObsLayerPlugin, ObsPlacement } from "@strangecyan/vignette/obs";
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

/** One show's mailbox: its command sequence and whether the loader answered. */
interface Mailbox {
  seq: number;
  installed?: boolean;
  created?: boolean;
  /** Inputs whose opacity filter exists. */
  readonly filtered: Set<string>;
}
const mailboxes = new Map<string, Mailbox>();
/** Directories whose loader file is current. */
const loaders = new Set<string>();

const OPACITY_FILTER = "vignette/opacity";
const MAILBOX = "mailbox";

export const motionObsLayer: ObsLayerPlugin<typeof MotionLayer> = {
  kind: MotionLayer.definition.kind,

  // Each placement's chunk takes its defaults (`initial`, `animate`, the transition) separately.
  async place(placements, context) {
    const chunks: Chunk[] = [];
    for (const placement of placements) {
      const motion = motionOf(placement.item) ?? {};
      await prepareItem(placement, motion, context);
      const chunk = placementChunk(placement, motion);
      if (chunk === undefined) await placeAtRest(placement, context);
      else chunks.push(chunk);
    }
    const fallback = async () => {
      for (const chunk of chunks) await placeAtRest(chunk.placement, context);
    };
    if (chunks.length > 0) await run(context, chunks, { wait: false, fallback });
  },

  // Only placements with an `exit` make a chunk; none means nothing to wait for.
  async remove(placements, context) {
    const chunks: Chunk[] = [];
    for (const placement of placements) {
      const motion = motionOf(placement.item) ?? {};
      if (motion.exit === undefined) continue;
      chunks.push({
        placement,
        label: "exit",
        to: apply(restVisual(placement), motion.exit),
        transition: motion.transition ?? DEFAULT_TRANSITION,
        hideAtEnd: true,
      });
    }
    if (chunks.length === 0) return;
    await run(context, chunks, { wait: true, fallback: () => Promise.resolve() });
  },
};

/**
 * The chunk a placement needs, by visibility: becoming visible (or new) enters from `initial`,
 * staying visible retargets, becoming hidden exits, and staying hidden needs no chunk at all
 * (undefined: the item is put at rest, disabled).
 */
function placementChunk(placement: ObsPlacement, motion: MotionProps): Chunk | undefined {
  const { item, previous } = placement;
  const rest = restVisual(placement);
  const transition = motion.transition ?? DEFAULT_TRANSITION;
  const wasVisible = previous?.visible === true;
  if (!item.visible) return wasVisible ? hideChunk(placement, motion, rest) : undefined;
  const to = apply(rest, motion.animate ?? {});
  if (wasVisible) return { placement, label: "retarget", to, transition };
  // `initial={false}` starts at `animate` with no enter; never from OBS's default for a new item.
  const from = motion.initial === false ? to : apply(rest, motion.initial ?? {});
  return { placement, label: "enter", from, to, transition };
}

/** The exit a shown item plays on becoming hidden; none without an `exit`: it just hides. */
function hideChunk(placement: ObsPlacement, motion: MotionProps, rest: Visual): Chunk | undefined {
  if (motion.exit === undefined) return undefined;
  const transition = motion.transition ?? DEFAULT_TRANSITION;
  return { placement, label: "hide", to: apply(rest, motion.exit), transition, hideAtEnd: true };
}

/** What a plain layer would get: the loader is missing, so the item just sits at rest. */
async function placeAtRest(placement: ObsPlacement, context: ObsLayerContext): Promise<void> {
  await context.call("SetSceneItemTransform", {
    sceneName: placement.sceneName,
    sceneItemId: placement.sceneItemId,
    sceneItemTransform: placement.transform,
  });
  await context.call("SetSceneItemEnabled", {
    sceneName: placement.sceneName,
    sceneItemId: placement.sceneItemId,
    sceneItemEnabled: placement.item.visible,
  });
}

/** One chunk to generate: a placement and the motion it makes. */
interface Chunk {
  readonly placement: ObsPlacement;
  readonly label: string;
  readonly from?: Visual;
  readonly to: Visual;
  readonly transition: Transition;
  readonly hideAtEnd?: boolean;
}

interface RunOptions {
  /** Resolve only once every chunk has settled (exits), not once the loader has them. */
  readonly wait: boolean;
  /** What to do when the loader is not installed. */
  readonly fallback: () => Promise<void>;
}

/**
 * Writes the chunks and hands them to the loader as one command, waiting for one acknowledgement;
 * runs the fallback when the loader is absent.
 */
async function run(context: ObsLayerContext, chunks: readonly Chunk[], options: RunOptions) {
  const inputName = context.resourceName(MAILBOX);
  const mailbox = mailboxes.get(inputName) ?? {
    seq: Date.now() % 1_000_000_000,
    filtered: new Set(),
  };
  mailboxes.set(inputName, mailbox);
  const dir = await context.directory();
  await ensureLoader(dir);
  await ensureMailbox(context, inputName, mailbox);
  const load = await Promise.all(
    chunks.map(async (chunk) => ({
      key: `${chunk.placement.sceneId}:${chunk.placement.item.id}`,
      path: (await writeChunk(dir, chunk)).replaceAll("\\", "/"),
    })),
  );
  mailbox.seq += 1;
  const seq = mailbox.seq;
  await context.call("SetInputSettings", {
    inputName,
    inputSettings: { seq, load },
    overlay: true,
  });
  // A loader known to be missing gets a short wait, so every revision is not slowed by it.
  const patience = mailbox.installed === false ? 300 : 2_000;
  const acked = await waitForState(context, inputName, (state) => state.ack_seq >= seq, patience);
  if (!acked) {
    if (mailbox.installed !== false) warnMissingLoader(dir);
    mailbox.installed = false;
    await options.fallback();
    return;
  }
  mailbox.installed = true;
  if (!options.wait) return;
  const budget =
    Math.max(...chunks.map((chunk) => settleSeconds(chunk.transition))) * 1_000 + 1_500;
  const keys = load.map((entry) => entry.key);
  await waitForState(
    context,
    inputName,
    (state) => {
      const done = new Set(state.done.split(","));
      return keys.every((key) => done.has(key));
    },
    budget,
  );
}

/**
 * The mailbox input, created once per show in the registry scene, disabled: a tiny colour source
 * whose settings carry commands one way and the loader's answers the other.
 */
async function ensureMailbox(
  context: ObsLayerContext,
  inputName: string,
  mailbox: Mailbox,
): Promise<void> {
  if (mailbox.created === true) return;
  try {
    await context.call("GetInputSettings", { inputName });
  } catch {
    await context.call("CreateInput", {
      sceneName: context.registryScene,
      inputName,
      inputKind: "color_source_v3",
      inputSettings: { seq: 0, width: 2, height: 2 },
      sceneItemEnabled: false,
    });
  }
  mailbox.created = true;
}

async function writeChunk(dir: string, chunk: Chunk): Promise<string> {
  const { placement } = chunk;
  const lua = generateChunk({
    sceneName: placement.sceneName,
    sceneItemId: placement.sceneItemId,
    opacityInput: fades(placement.item, motionOf(placement.item))
      ? inputName(placement)
      : undefined,
    label: chunk.label,
    from: chunk.from,
    to: chunk.to,
    transition: chunk.transition,
    hideAtEnd: chunk.hideAtEnd,
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
function restVisual(placement: ObsPlacement): Visual {
  const t = placement.transform;
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
  placement: ObsPlacement,
  motion: MotionProps,
  context: ObsLayerContext,
): Promise<void> {
  const { item } = placement;
  if (placement.previous === undefined) {
    const t = placement.transform;
    await context.call("SetSceneItemTransform", {
      sceneName: placement.sceneName,
      sceneItemId: placement.sceneItemId,
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
  const sourceName = inputName(placement);
  const filtered = mailboxes.get(context.resourceName(MAILBOX))?.filtered;
  if (filtered?.has(sourceName)) return;
  const list: FilterList = FilterListSchema.parse(
    await context.call("GetSourceFilterList", { sourceName }),
  );
  if (!list.filters.some((filter) => filter.filterName === OPACITY_FILTER)) {
    await context.call("CreateSourceFilter", {
      sourceName,
      filterName: OPACITY_FILTER,
      filterKind: "color_filter_v2",
      filterSettings: { opacity: item.opacity },
    });
  }
  filtered?.add(sourceName);
}

/** The managed input's name: the target's naming, reproduced from the scene name's prefix. */
function inputName(placement: ObsPlacement): string {
  const prefix = placement.sceneName.slice(0, placement.sceneName.lastIndexOf("/"));
  return `${prefix}/${placement.source.id}`;
}

async function ensureLoader(dir: string): Promise<void> {
  if (loaders.has(dir)) return;
  const path = join(dir, "loader.lua");
  const current = await readFile(path, "utf8").catch(() => undefined);
  if (current !== LOADER_LUA) await writeFile(path, LOADER_LUA);
  loaders.add(dir);
}

/** What the loader writes back into the mailbox's settings. */
const LoaderStateSchema = z.object({
  inputSettings: z.object({
    loader: z.string().optional(),
    ack_seq: z.number().optional(),
    done: z.string().optional(),
  }),
});
type LoaderState = z.output<typeof LoaderStateSchema>;

/** The parts of a {@link LoaderState} a wait reads. */
interface LoaderAnswer {
  readonly ack_seq: number;
  readonly done: string;
}

/** Polls the mailbox until `test` holds or `timeoutMs` passes; false on timeout. */
async function waitForState(
  context: ObsLayerContext,
  inputName: string,
  test: (state: LoaderAnswer) => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const state = await readState(context, inputName);
    if (state !== undefined && test(state)) return true;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  return false;
}

/** The loader's answer, or undefined while a loader of this version has not written one. */
async function readState(
  context: ObsLayerContext,
  inputName: string,
): Promise<LoaderAnswer | undefined> {
  const parsed = LoaderStateSchema.safeParse(await context.call("GetInputSettings", { inputName }));
  if (!parsed.success) return undefined;
  const state: LoaderState = parsed.data;
  const { loader, ack_seq, done } = state.inputSettings;
  if (loader !== LOADER_VERSION || ack_seq === undefined) return undefined;
  return { ack_seq, done: done ?? "" };
}
