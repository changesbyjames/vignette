import { omitUndefined } from "../objects.js";
import type {
  BroadcastNode,
  SceneNode,
  LayerNode,
  SceneLayerNode,
  LayoutStyle,
} from "../authoring.js";
import { diagnostic, type Diagnostic } from "../diagnostics.js";
import { CENTER_ALIGNMENT, intersectRects, type Rect, type Size } from "../geometry.js";
import { deepFreeze } from "../objects.js";
import type { CompiledItem, CompiledScene, CompiledSnapshot, CompiledSource } from "../snapshot.js";
import { resolveSourceModules, type SourceModuleMap } from "../source-module.js";
import type { AnySourceDefinition } from "../sources.js";
import { validateBroadcast } from "../validation.js";
import { calculateContentPlacement } from "./content-fit.js";
import type { LayoutEngine, LayoutRecord } from "./layout-engine.js";
import { roundRect } from "./rounding.js";

interface CompileSuccess {
  readonly ok: true;
  readonly snapshot: CompiledSnapshot;
  readonly diagnostics: readonly Diagnostic[];
}

interface CompileFailure {
  readonly ok: false;
  readonly diagnostics: readonly Diagnostic[];
}

interface LayoutOrigin {
  x: number;
  y: number;
}

/** Inputs controlling one authoring-graph compilation. */
export interface CompileOptions {
  readonly revision: number;
  readonly modules?: SourceModuleMap;
  readonly layoutEngine: LayoutEngine;
}

/** Successful immutable snapshot compilation or deterministic diagnostics. */
export type CompileResult = CompileSuccess | CompileFailure;

/** Validates and compiles an authoring graph into a target-neutral snapshot. */
export function compileBroadcast(root: BroadcastNode, options: CompileOptions): CompileResult {
  const modules = options.modules ?? resolveSourceModules();
  const validation = validateBroadcast(root, { modules });
  const diagnostics = [...validation.diagnostics];

  if (!Number.isSafeInteger(options.revision) || options.revision < 0) {
    diagnostics.push(
      diagnostic(
        "LAYOUT_COMPILE_FAILED",
        "error",
        "options.revision",
        "Snapshot revision must be a non-negative safe integer.",
      ),
    );
  }

  if (diagnostics.some((item) => item.severity === "error")) {
    return { ok: false, diagnostics: sortDiagnostics(diagnostics) };
  }

  const compiledSources = collectSources(root).map(compileSource(modules));
  const sourcesById = new Map(compiledSources.map((source) => [source.id, source]));
  const compiledScenes: CompiledScene[] = [];

  for (const scene of collectScenes(root)) {
    const compiled = compileScene(
      scene,
      root.canvas,
      options.layoutEngine,
      sourcesById,
      diagnostics,
    );
    if (compiled !== undefined) compiledScenes.push(compiled);
  }

  const sortedDiagnostics = sortDiagnostics(diagnostics);
  if (sortedDiagnostics.some((item) => item.severity === "error")) {
    return { ok: false, diagnostics: sortedDiagnostics };
  }

  const canvas =
    root.canvas.frameRate === undefined
      ? { width: root.canvas.width, height: root.canvas.height }
      : {
          width: root.canvas.width,
          height: root.canvas.height,
          frameRate: root.canvas.frameRate,
        };
  const warnings = sortedDiagnostics.filter((item) => item.severity === "warning");

  // Snapshots cross the core→target boundary, so the finished snapshot is deep-frozen once
  // to make accidental mutation by any consumer fail loudly.
  const snapshot: CompiledSnapshot = deepFreeze({
    revision: options.revision,
    projectId: root.projectId,
    canvas,
    sources: compiledSources,
    scenes: compiledScenes,
    warnings,
  });

  return { ok: true, snapshot, diagnostics: sortedDiagnostics };
}

/** Keep layout failures local to their scene so diagnostics from other scenes remain deterministic. */
function compileScene(
  scene: SceneNode,
  canvas: Size,
  engine: LayoutEngine,
  sourcesById: ReadonlyMap<string, CompiledSource>,
  diagnostics: Diagnostic[],
): CompiledScene | undefined {
  try {
    const items: CompiledItem[] = [];
    for (const record of engine.layout(scene.children, canvas))
      compileRecord(record, { x: 0, y: 0 }, undefined, sourcesById, items, diagnostics);
    return omitUndefined({ id: scene.id, label: scene.label, items });
  } catch (cause) {
    diagnostics.push(
      diagnostic(
        "LAYOUT_COMPILE_FAILED",
        "error",
        `scene.${scene.id}`,
        cause instanceof Error ? cause.message : "Layout failed with an unknown error.",
        [scene.id],
      ),
    );
    return undefined;
  }
}

/** Boxes propagate world-space origins and clips; only materialized layers become snapshot items. */
function compileRecord(
  record: LayoutRecord,
  parentOrigin: Readonly<LayoutOrigin>,
  inheritedClip: Rect | null | undefined,
  sourcesById: ReadonlyMap<string, CompiledSource>,
  items: CompiledItem[],
  diagnostics: Diagnostic[],
): void {
  const layout = record.frame;
  const rawFrame: Rect = {
    x: parentOrigin.x + layout.x,
    y: parentOrigin.y + layout.y,
    width: layout.width,
    height: layout.height,
  };
  const node = record.node;
  if (node.kind === "box") {
    const childClip = clipForBox(node.style, rawFrame, inheritedClip);
    for (const child of record.children)
      compileRecord(child, rawFrame, childClip, sourcesById, items, diagnostics);
    return;
  }
  items.push(compileLayer(node, record.path, rawFrame, inheritedClip, sourcesById, diagnostics));
}

/** undefined means no clipping, while null means an already-empty inherited clip. */
function clipForBox(
  style: LayoutStyle | undefined,
  rawFrame: Rect,
  inheritedClip: Rect | null | undefined,
): Rect | null | undefined {
  if (style?.overflow !== "hidden") return inheritedClip;
  if (inheritedClip === null) return null;
  return inheritedClip === undefined ? rawFrame : (intersectRects(inheritedClip, rawFrame) ?? null);
}

interface LayerVisibility {
  readonly visible: boolean;
  readonly clip?: Rect;
}

/** Clip before rounding so fractional Yoga geometry does not change intersection decisions. */
function layerVisibility(rawFrame: Rect, inheritedClip: Rect | null | undefined): LayerVisibility {
  const visibleRect =
    inheritedClip === null
      ? undefined
      : inheritedClip === undefined
        ? rawFrame
        : intersectRects(inheritedClip, rawFrame);
  const clip = visibleRect === undefined ? undefined : roundRect(visibleRect);
  const isClipped = clip !== undefined && !rectEquals(clip, roundRect(rawFrame));
  return omitUndefined({ visible: visibleRect !== undefined, clip: isClipped ? clip : undefined });
}

/** Compute clipping from unrounded layout bounds, then emit either scene content or fitted source content. */
function compileLayer(
  node: LayerNode | SceneLayerNode,
  path: string,
  rawFrame: Rect,
  inheritedClip: Rect | null | undefined,
  sourcesById: ReadonlyMap<string, CompiledSource>,
  diagnostics: Diagnostic[],
): CompiledItem {
  const frame = roundRect(rawFrame);
  if (frame.width <= 0 || frame.height <= 0)
    diagnostics.push(
      diagnostic(
        "INVALID_LAYOUT_VALUE",
        "error",
        path,
        `Materialized layer '${node.id}' resolved to a non-positive frame.`,
        [node.id],
      ),
    );
  const visibility = layerVisibility(rawFrame, inheritedClip);
  const common = omitUndefined({
    id: node.id,
    frame,
    clip: visibility.clip,
    visible: node.visible !== false && visibility.visible,
    opacity: node.opacity ?? 1,
    rotation: node.rotation ?? 0,
  });
  if (node.kind === "scene-layer")
    return { ...common, content: { kind: "scene", sceneId: node.sceneId } };
  return {
    ...common,
    content: { kind: "source", sourceId: node.sourceId },
    ...omitUndefined({ placement: fitSourceLayer(node, path, frame, sourcesById, diagnostics) }),
  };
}

/** Invalid fitting inputs become diagnostics while the rest of the graph can still be compiled. */
function fitSourceLayer(
  node: LayerNode,
  path: string,
  frame: Rect,
  sourcesById: ReadonlyMap<string, CompiledSource>,
  diagnostics: Diagnostic[],
): CompiledItem["placement"] {
  const fitResult = calculateContentPlacement(
    omitUndefined({
      destination: frame,
      fit: node.fit ?? "fill",
      alignment: node.alignment ?? CENTER_ALIGNMENT,
      sourceSize: sourcesById.get(node.sourceId)?.intrinsicSize,
      manualCrop: node.crop,
    }),
  );
  if (fitResult.ok) return fitResult.placement;
  diagnostics.push(
    diagnostic("INVALID_SOURCE_SIZE", "error", path, `Layer '${node.id}': ${fitResult.message}`, [
      node.id,
      node.sourceId,
    ]),
  );
  return undefined;
}

function collectSources(root: BroadcastNode): AnySourceDefinition[] {
  return root.children.flatMap((child) => (child.kind === "sources" ? [...child.children] : []));
}

function collectScenes(root: BroadcastNode): SceneNode[] {
  return root.children.filter((child): child is SceneNode => child.kind === "scene");
}

function compileSource(
  modules: SourceModuleMap,
): (definition: AnySourceDefinition) => CompiledSource {
  return (definition) => {
    // Source modules supply intrinsic dimensions and assets; omit unavailable metadata from the snapshot.
    const module = modules.get(definition.kind);
    const intrinsicSize = module?.intrinsicSize(definition);
    const asset = module?.asset?.(definition);
    return {
      id: definition.id,
      definition: structuredClone(definition),
      ...omitUndefined({
        intrinsicSize: intrinsicSize === undefined ? undefined : { ...intrinsicSize },
      }),
      ...omitUndefined({ asset: asset === undefined ? undefined : { ...asset } }),
    };
  };
}

function rectEquals(left: Rect, right: Rect): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function sortDiagnostics(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  return [...diagnostics].sort((left, right) =>
    left.path === right.path
      ? left.code.localeCompare(right.code)
      : left.path.localeCompare(right.path),
  );
}
