import { diagnostic, sortDiagnostics, type Diagnostic } from "../diagnostics.js";
import {
  CENTER_ALIGNMENT,
  intersectRects,
  rectEquals,
  type ContentAlignment,
  type Rect,
  type Size,
} from "../geometry.js";
import { PLAIN_LAYER_KIND } from "../define-layer.js";
import { deepFreeze } from "../objects.js";
import {
  isGroupNode,
  isSourceRef,
  type ShowTree,
  type ShowTreeScene,
  type SourceLayoutNode,
} from "../show-tree.js";
import type {
  ContentPlacement,
  Item,
  LayerAlign,
  Snapshot,
  SnapshotScene,
  Source,
} from "../snapshot.js";
import { calculateContentPlacement } from "./content-fit.js";
import type { LayoutEngine, LayoutRecord } from "./layout-engine.js";
import { roundRect } from "./rounding.js";

interface CompileSuccess {
  readonly ok: true;
  readonly snapshot: Snapshot;
  readonly diagnostics: readonly Diagnostic[];
}

interface CompileFailure {
  readonly ok: false;
  readonly diagnostics: readonly Diagnostic[];
}

/** Inputs controlling one compilation. The active scene comes from the tree. */
export interface CompileOptions {
  readonly revision: number;
  readonly layoutEngine: LayoutEngine;
}

/** Successful immutable snapshot compilation or deterministic diagnostics. */
export type CompileResult = CompileSuccess | CompileFailure;

/** Presentation a group layer passes down to the layers inside it. */
interface Inherited {
  readonly visible: boolean;
  readonly opacity: number;
}

/** Mutable state shared by every record of one compilation. */
interface CompileContext {
  readonly canvas: Rect;
  readonly shared: ReadonlyMap<string, Source>;
  readonly inlineSources: Source[];
  readonly diagnostics: Diagnostic[];
}

/**
 * Lays out a lowered show and compiles it into an immutable snapshot. The input must already be
 * valid: lowering checked props schemas and `validateShow` the structure (duplicate IDs, dangling
 * `<Use>`). The compiler reports only what layout itself can get wrong. Items are clipped to the
 * canvas and nothing else.
 */
export function compileShow(tree: ShowTree, options: CompileOptions): CompileResult {
  const context: CompileContext = {
    canvas: { x: 0, y: 0, width: tree.canvas.width, height: tree.canvas.height },
    shared: new Map(tree.sharedSources.map((source) => [source.id, source])),
    inlineSources: [],
    diagnostics: [],
  };

  const scenes = tree.scenes.flatMap((scene) => compileScene(scene, options.layoutEngine, context));
  const diagnostics = sortDiagnostics(context.diagnostics);
  if (diagnostics.some((item) => item.severity === "error")) return { ok: false, diagnostics };

  // Snapshots cross the core→target boundary, so the finished snapshot is deep-frozen once
  // to make accidental mutation by any consumer fail loudly.
  const snapshot: Snapshot = deepFreeze({
    revision: options.revision,
    id: tree.id,
    canvas: { ...tree.canvas },
    activeScene: tree.activeScene,
    sources: [...tree.sharedSources, ...context.inlineSources],
    scenes,
  });
  return { ok: true, snapshot, diagnostics };
}

/** Keep layout failures local to their scene so diagnostics from other scenes remain deterministic. */
function compileScene(
  scene: ShowTreeScene,
  engine: LayoutEngine,
  context: CompileContext,
): readonly SnapshotScene[] {
  try {
    const items: Item[] = [];
    const records = engine.layout([scene.root], context.canvas);
    for (const record of records) {
      compileRecord(record, `scene.${scene.id}`, context.canvas, ROOT, items, context);
    }
    return [{ id: scene.id, items }];
  } catch (cause) {
    context.diagnostics.push(
      diagnostic(
        "LAYOUT_COMPILE_FAILED",
        "error",
        `scene.${scene.id}`,
        cause instanceof Error ? cause.message : "Layout failed with an unknown error.",
        [scene.id],
      ),
    );
    return [];
  }
}

const ROOT: Inherited = { visible: true, opacity: 1 };

/** Groups pass their origin and presentation down; only layers that place a source become items. */
function compileRecord(
  record: LayoutRecord,
  scenePath: string,
  parentOrigin: Rect,
  inherited: Inherited,
  items: Item[],
  context: CompileContext,
): void {
  const rawFrame: Rect = {
    x: parentOrigin.x + record.frame.x,
    y: parentOrigin.y + record.frame.y,
    width: record.frame.width,
    height: record.frame.height,
  };
  const node = record.node;
  const presentation: Inherited = {
    visible: inherited.visible && node.layer.visible !== false,
    opacity: inherited.opacity * (node.layer.opacity ?? 1),
  };
  if (isGroupNode(node)) {
    // A layer kind describes a placement; a group is never placed, so its kind has no meaning.
    if (node.kind !== PLAIN_LAYER_KIND) {
      context.diagnostics.push(
        diagnostic(
          "INVALID_TREE",
          "error",
          `${scenePath}.${record.path}`,
          `Layer '${node.id}' is a '${node.kind}' layer but groups layers; only a layer that places a source has a kind.`,
          [node.id],
        ),
      );
      return;
    }
    // A group passes `visible` and `opacity` down. Its `rotation` is ignored: rotating a group
    // would need composed transforms per item, which no target models and the README does not
    // promise. `fit`, `align` and `crop` describe placed content, so a group has nothing to apply
    // them to.
    for (const child of record.children) {
      compileRecord(child, scenePath, rawFrame, presentation, items, context);
    }
    return;
  }
  const item = compileItem(node, `${scenePath}.${record.path}`, rawFrame, presentation, context);
  if (item !== undefined) items.push(item);
}

/** Resolve the placed source, size inline sources from the rounded frame, then fit the content. */
function compileItem(
  node: SourceLayoutNode,
  path: string,
  rawFrame: Rect,
  presentation: Inherited,
  context: CompileContext,
): Item | undefined {
  const frame = roundRect(rawFrame);
  if (frame.width <= 0 || frame.height <= 0) {
    context.diagnostics.push(
      diagnostic(
        "INVALID_LAYOUT_VALUE",
        "error",
        path,
        `Layer '${node.id}' resolved to a non-positive frame.`,
        [node.id],
      ),
    );
    return undefined;
  }

  const source = resolveSource(node, frame, context);

  const placement = fitContent(node, path, frame, source, context);
  if (placement === undefined) return undefined;

  // Clip before rounding so fractional Yoga geometry does not change intersection decisions.
  const onCanvas = intersectRects(context.canvas, rawFrame);
  const clip = onCanvas === undefined ? undefined : roundRect(onCanvas);
  return {
    id: node.id,
    sourceId: source.id,
    frame,
    placement,
    clip: clip === undefined || rectEquals(clip, frame) ? undefined : clip,
    visible: presentation.visible && onCanvas !== undefined,
    opacity: presentation.opacity,
    rotation: node.layer.rotation ?? 0,
    kind: node.kind,
    props: node.props,
  };
}

function resolveSource(node: SourceLayoutNode, frame: Size, context: CompileContext): Source {
  if (!isSourceRef(node.source)) {
    const inline = node.source;
    const source: Source = {
      id: inline.id,
      kind: inline.kind,
      props: inline.props,
      size: inline.size({ width: frame.width, height: frame.height }),
    };
    context.inlineSources.push(source);
    return source;
  }
  const shared = context.shared.get(node.source.ref);
  // validateShow reports a dangling <Use> before compilation; reaching this is a caller bug.
  if (shared === undefined) throw new Error(`Layer '${node.id}' uses undeclared source.`);
  return shared;
}

function fitContent(
  node: SourceLayoutNode,
  path: string,
  frame: Rect,
  source: Source,
  context: CompileContext,
): ContentPlacement | undefined {
  const result = calculateContentPlacement({
    destination: frame,
    fit: node.layer.fit ?? "stretch",
    alignment: contentAlignment(node.layer.align),
    sourceSize: source.size,
    manualCrop: node.layer.crop,
  });
  if (result.ok) return result.placement;
  context.diagnostics.push(
    diagnostic("INVALID_LAYOUT_VALUE", "error", path, `Layer '${node.id}': ${result.message}`, [
      node.id,
      source.id,
    ]),
  );
  return undefined;
}

/** A layer's `align` names either axis; an omitted axis is centered. */
function contentAlignment(align: LayerAlign | undefined): ContentAlignment {
  return {
    horizontal: align?.horizontal ?? CENTER_ALIGNMENT.horizontal,
    vertical: align?.vertical ?? CENTER_ALIGNMENT.vertical,
  };
}
