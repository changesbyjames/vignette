import type { BroadcastNode, SceneNode } from "../authoring.js";
import { diagnostic, type Diagnostic } from "../diagnostics.js";
import { CENTER_ALIGNMENT, intersectRects, type Rect } from "../geometry.js";
import { deepFreeze } from "../objects.js";
import type { CompiledItem, CompiledScene, CompiledSnapshot, CompiledSource } from "../snapshot.js";
import { resolveSourceModules, type SourceModuleMap } from "../source-module.js";
import type { AnySourceDefinition } from "../sources.js";
import { validateBroadcast } from "../validation.js";
import { calculateContentPlacement } from "./content-fit.js";
import type { LayoutEngine, LayoutRecord } from "./layout-engine.js";
import { roundRect } from "./rounding.js";

/** Inputs controlling one authoring-graph compilation. */
export interface CompileOptions {
  readonly revision: number;
  readonly modules?: SourceModuleMap;
  readonly layoutEngine: LayoutEngine;
}

/** Successful immutable snapshot compilation or deterministic diagnostics. */
export type CompileResult =
  | {
      readonly ok: true;
      readonly snapshot: CompiledSnapshot;
      readonly diagnostics: readonly Diagnostic[];
    }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

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
    try {
      const items: CompiledItem[] = [];
      options.layoutEngine.layout(scene.children, root.canvas).forEach((record) => {
        compileRecord(record, { x: 0, y: 0 }, undefined, sourcesById, items, diagnostics);
      });
      compiledScenes.push(
        scene.label === undefined
          ? { id: scene.id, items }
          : { id: scene.id, label: scene.label, items },
      );
    } catch (error) {
      diagnostics.push(
        diagnostic(
          "LAYOUT_COMPILE_FAILED",
          "error",
          `scene.${scene.id}`,
          error instanceof Error ? error.message : "Layout failed with an unknown error.",
          [scene.id],
        ),
      );
    }
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

function compileRecord(
  record: LayoutRecord,
  parentOrigin: Readonly<{ x: number; y: number }>,
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
  const frame = roundRect(rawFrame);

  if (record.node.kind === "box") {
    let childClip = inheritedClip;
    if (record.node.style?.overflow === "hidden") {
      childClip =
        inheritedClip === null
          ? null
          : ((inheritedClip === undefined ? rawFrame : intersectRects(inheritedClip, rawFrame)) ??
            null);
    }

    record.children.forEach((child) => {
      compileRecord(
        child,
        { x: rawFrame.x, y: rawFrame.y },
        childClip,
        sourcesById,
        items,
        diagnostics,
      );
    });
    return;
  }

  if (frame.width <= 0 || frame.height <= 0) {
    diagnostics.push(
      diagnostic(
        "INVALID_LAYOUT_VALUE",
        "error",
        record.path,
        `Materialized layer '${record.node.id}' resolved to a non-positive frame.`,
        [record.node.id],
      ),
    );
  }

  const visibleRect =
    inheritedClip === null
      ? undefined
      : inheritedClip === undefined
        ? rawFrame
        : intersectRects(inheritedClip, rawFrame);
  const clip = visibleRect === undefined ? undefined : roundRect(visibleRect);
  const isClipped = clip !== undefined && !rectEquals(clip, frame);
  const visible = record.node.visible !== false && visibleRect !== undefined;

  if (record.node.kind === "scene-layer") {
    items.push({
      id: record.node.id,
      content: { kind: "scene", sceneId: record.node.sceneId },
      frame,
      ...(isClipped ? { clip } : {}),
      visible,
      opacity: record.node.opacity ?? 1,
      rotation: record.node.rotation ?? 0,
    });
    return;
  }

  const sourceSize = sourcesById.get(record.node.sourceId)?.intrinsicSize;
  const fitResult = calculateContentPlacement({
    destination: frame,
    fit: record.node.fit ?? "fill",
    alignment: record.node.alignment ?? CENTER_ALIGNMENT,
    ...(sourceSize === undefined ? {} : { sourceSize }),
    ...(record.node.crop === undefined ? {} : { manualCrop: record.node.crop }),
  });

  if (!fitResult.ok) {
    diagnostics.push(
      diagnostic(
        "INVALID_SOURCE_SIZE",
        "error",
        record.path,
        `Layer '${record.node.id}': ${fitResult.message}`,
        [record.node.id, record.node.sourceId],
      ),
    );
  }

  items.push({
    id: record.node.id,
    content: { kind: "source", sourceId: record.node.sourceId },
    frame,
    ...(isClipped ? { clip } : {}),
    ...(fitResult.ok ? { placement: fitResult.placement } : {}),
    visible,
    opacity: record.node.opacity ?? 1,
    rotation: record.node.rotation ?? 0,
  });
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
    const module = modules.get(definition.kind);
    const intrinsicSize = module?.intrinsicSize(definition);
    const asset = module?.asset?.(definition);
    return {
      id: definition.id,
      definition: structuredClone(definition),
      ...(intrinsicSize === undefined ? {} : { intrinsicSize: { ...intrinsicSize } }),
      ...(asset === undefined ? {} : { asset: { ...asset } }),
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
