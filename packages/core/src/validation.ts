import type {
  BroadcastNode,
  Edges,
  LayoutNode,
  LayoutStyle,
  Length,
  SceneNode,
} from "./authoring.js";
import { diagnostic, type Diagnostic, type ValidationResult } from "./diagnostics.js";
import { isFiniteNumber, isPositiveSize, type Insets, type Size } from "./geometry.js";
import { isStableId } from "./ids.js";
import { resolveSourceModules, type SourceModuleMap } from "./source-module.js";
import type { AnySourceDefinition } from "./sources.js";

interface LocatedScene {
  readonly scene: SceneNode;
  readonly path: string;
}

interface LocatedSource {
  readonly source: AnySourceDefinition;
  readonly path: string;
}

/** Extension source modules used while validating an authoring graph. */
export interface ValidateBroadcastOptions {
  readonly modules?: SourceModuleMap;
}

/** Validates IDs, references, sources, layout values, and scene topology. */
export function validateBroadcast(
  root: BroadcastNode,
  options: ValidateBroadcastOptions = {},
): ValidationResult {
  const modules = options.modules ?? resolveSourceModules();
  const diagnostics: Diagnostic[] = [];
  const scenes: LocatedScene[] = [];
  const sources: LocatedSource[] = [];

  validateId(root.projectId, "INVALID_PROJECT_ID", "broadcast.projectId", diagnostics);
  validateCanvas(root.canvas, diagnostics);

  root.children.forEach((child, childIndex) => {
    const path = `broadcast.children[${String(childIndex)}]`;
    if (child.kind === "sources") {
      child.children.forEach((source, sourceIndex) => {
        sources.push({ source, path: `${path}.children[${String(sourceIndex)}]` });
      });
    } else {
      scenes.push({ scene: child, path });
    }
  });

  const sourcesById = indexSources(sources, diagnostics);
  const scenesById = indexScenes(scenes, diagnostics);
  const layerPaths = new Map<string, string>();
  const referencedSources = new Set<string>();

  for (const located of sources) validateSource(located, modules, diagnostics);

  for (const located of scenes) {
    validateId(located.scene.id, "INVALID_SCENE_ID", `${located.path}.id`, diagnostics);
    located.scene.children.forEach((node, index) => {
      validateLayoutNode(
        node,
        `${located.path}.children[${String(index)}]`,
        sourcesById,
        scenesById,
        layerPaths,
        referencedSources,
        diagnostics,
      );
    });

    validateRepeatedPlacements(located, diagnostics);
  }

  validateSceneCycles(scenes, scenesById, diagnostics);

  for (const located of sources) {
    if (!referencedSources.has(located.source.id)) {
      diagnostics.push(
        diagnostic(
          "UNREACHABLE_SOURCE",
          "warning",
          `${located.path}.id`,
          `Source '${located.source.id}' is declared but not placed in any scene.`,
          [located.source.id],
        ),
      );
    }
  }

  diagnostics.sort((left, right) =>
    left.path === right.path
      ? left.code.localeCompare(right.code)
      : left.path.localeCompare(right.path),
  );

  const errors = diagnostics.filter((item) => item.severity === "error");
  const warnings = diagnostics.filter((item) => item.severity === "warning");
  return { valid: errors.length === 0, diagnostics, errors, warnings };
}

function indexSources(
  sources: readonly LocatedSource[],
  diagnostics: Diagnostic[],
): ReadonlyMap<string, LocatedSource> {
  const result = new Map<string, LocatedSource>();
  for (const located of sources) {
    validateId(located.source.id, "INVALID_SOURCE_ID", `${located.path}.id`, diagnostics);
    const previous = result.get(located.source.id);
    if (previous !== undefined) {
      diagnostics.push(
        diagnostic(
          "DUPLICATE_SOURCE_ID",
          "error",
          `${located.path}.id`,
          `Source ID '${located.source.id}' is already declared.`,
          [previous.path, located.path],
        ),
      );
    } else {
      result.set(located.source.id, located);
    }
  }
  return result;
}

function indexScenes(
  scenes: readonly LocatedScene[],
  diagnostics: Diagnostic[],
): ReadonlyMap<string, LocatedScene> {
  const result = new Map<string, LocatedScene>();
  for (const located of scenes) {
    const previous = result.get(located.scene.id);
    if (previous !== undefined) {
      diagnostics.push(
        diagnostic(
          "DUPLICATE_SCENE_ID",
          "error",
          `${located.path}.id`,
          `Scene ID '${located.scene.id}' is already declared.`,
          [previous.path, located.path],
        ),
      );
    } else {
      result.set(located.scene.id, located);
    }
  }
  return result;
}

function validateCanvas(canvas: Size & { readonly frameRate?: number }, diagnostics: Diagnostic[]) {
  if (!isPositiveSize(canvas)) {
    diagnostics.push(
      diagnostic(
        "INVALID_CANVAS",
        "error",
        "broadcast.canvas",
        "Canvas width and height must be finite positive numbers.",
      ),
    );
  }

  if (
    canvas.frameRate !== undefined &&
    (!isFiniteNumber(canvas.frameRate) || canvas.frameRate <= 0)
  ) {
    diagnostics.push(
      diagnostic(
        "INVALID_CANVAS",
        "error",
        "broadcast.canvas.frameRate",
        "Frame rate must be a finite positive number.",
      ),
    );
  }
}

function validateSource(
  located: LocatedSource,
  modules: SourceModuleMap,
  diagnostics: Diagnostic[],
) {
  const { source, path } = located;
  const module = modules.get(source.kind);
  if (module === undefined) {
    diagnostics.push(
      diagnostic(
        "UNKNOWN_SOURCE_KIND",
        "error",
        `${path}.kind`,
        `No source module is registered for kind '${source.kind}'. Register its extension when creating the composer root.`,
        [source.id],
      ),
    );
    return;
  }
  diagnostics.push(...(module.validate?.(source, path) ?? []));
}

function validateLayoutNode(
  node: LayoutNode,
  path: string,
  sources: ReadonlyMap<string, LocatedSource>,
  scenes: ReadonlyMap<string, LocatedScene>,
  layerPaths: Map<string, string>,
  referencedSources: Set<string>,
  diagnostics: Diagnostic[],
) {
  validateLayoutStyle(node.style, `${path}.style`, diagnostics);
  if (node.kind === "box") {
    node.children.forEach((child, index) => {
      validateLayoutNode(
        child,
        `${path}.children[${String(index)}]`,
        sources,
        scenes,
        layerPaths,
        referencedSources,
        diagnostics,
      );
    });
    return;
  }

  validateId(node.id, "INVALID_LAYER_ID", `${path}.id`, diagnostics);
  const previousPath = layerPaths.get(node.id);
  if (previousPath !== undefined) {
    diagnostics.push(
      diagnostic(
        "DUPLICATE_LAYER_ID",
        "error",
        `${path}.id`,
        `Layer ID '${node.id}' is already used.`,
        [previousPath, path],
      ),
    );
  } else {
    layerPaths.set(node.id, path);
  }

  validateLayerPresentation(node, path, diagnostics);
  if (node.kind === "layer") {
    referencedSources.add(node.sourceId);
    if (!sources.has(node.sourceId)) {
      diagnostics.push(
        diagnostic(
          "MISSING_SOURCE",
          "error",
          `${path}.sourceId`,
          `Layer references missing source '${node.sourceId}'.`,
          [node.sourceId],
        ),
      );
    }
    validateCrop(node.crop, `${path}.crop`, diagnostics);
  } else if (!scenes.has(node.sceneId)) {
    diagnostics.push(
      diagnostic(
        "MISSING_SCENE",
        "error",
        `${path}.sceneId`,
        `Layer references missing scene '${node.sceneId}'.`,
        [node.sceneId],
      ),
    );
  }
}

function validateLayerPresentation(
  node: Exclude<LayoutNode, { readonly kind: "box" }>,
  path: string,
  diagnostics: Diagnostic[],
) {
  if (
    node.opacity !== undefined &&
    (!isFiniteNumber(node.opacity) || node.opacity < 0 || node.opacity > 1)
  ) {
    diagnostics.push(
      diagnostic(
        "INVALID_LAYOUT_VALUE",
        "error",
        `${path}.opacity`,
        "Opacity must be between 0 and 1.",
      ),
    );
  }
  if (node.rotation !== undefined && !isFiniteNumber(node.rotation)) {
    diagnostics.push(
      diagnostic("INVALID_LAYOUT_VALUE", "error", `${path}.rotation`, "Rotation must be finite."),
    );
  }
}

function validateCrop(crop: Partial<Insets> | undefined, path: string, diagnostics: Diagnostic[]) {
  if (crop === undefined) return;
  for (const edge of ["top", "right", "bottom", "left"] as const) {
    const value = crop[edge];
    if (value !== undefined && (!isFiniteNumber(value) || value < 0)) {
      diagnostics.push(
        diagnostic(
          "INVALID_LAYOUT_VALUE",
          "error",
          `${path}.${edge}`,
          "Crop values must be finite and non-negative.",
        ),
      );
    }
  }
}

function validateLayoutStyle(
  style: LayoutStyle | undefined,
  path: string,
  diagnostics: Diagnostic[],
) {
  if (style === undefined) return;

  const dimensions: readonly (keyof Pick<
    LayoutStyle,
    "width" | "height" | "minWidth" | "minHeight" | "maxWidth" | "maxHeight" | "flexBasis"
  >)[] = ["width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight", "flexBasis"];

  for (const key of dimensions) validateLength(style[key], `${path}.${key}`, false, diagnostics);
  validateEdges(style.margin, `${path}.margin`, true, diagnostics);
  validateEdges(style.padding, `${path}.padding`, false, diagnostics);
  validateEdges(style.inset, `${path}.inset`, true, diagnostics);
  validateLength(style.gap, `${path}.gap`, false, diagnostics);
  validateLength(style.rowGap, `${path}.rowGap`, false, diagnostics);
  validateLength(style.columnGap, `${path}.columnGap`, false, diagnostics);

  for (const key of ["flexGrow", "flexShrink"] as const) {
    const value = style[key];
    if (value !== undefined && (!isFiniteNumber(value) || value < 0)) {
      diagnostics.push(
        diagnostic(
          "INVALID_LAYOUT_VALUE",
          "error",
          `${path}.${key}`,
          `${key} must be finite and non-negative.`,
        ),
      );
    }
  }

  if (
    style.aspectRatio !== undefined &&
    (!isFiniteNumber(style.aspectRatio) || style.aspectRatio <= 0)
  ) {
    diagnostics.push(
      diagnostic(
        "INVALID_LAYOUT_VALUE",
        "error",
        `${path}.aspectRatio`,
        "Aspect ratio must be a finite positive number.",
      ),
    );
  }
}

function validateEdges(
  edges: Edges<Length> | undefined,
  path: string,
  allowNegative: boolean,
  diagnostics: Diagnostic[],
) {
  if (edges === undefined) return;
  if (typeof edges === "number" || typeof edges === "string") {
    validateLength(edges, path, allowNegative, diagnostics);
    return;
  }
  for (const edge of ["top", "right", "bottom", "left"] as const) {
    validateLength(edges[edge], `${path}.${edge}`, allowNegative, diagnostics);
  }
}

function validateLength(
  value: Length | undefined,
  path: string,
  allowNegative: boolean,
  diagnostics: Diagnostic[],
) {
  if (value === undefined || value === "auto") return;
  const numeric = typeof value === "number" ? value : Number(value.slice(0, -1));
  if (!isFiniteNumber(numeric) || (!allowNegative && numeric < 0)) {
    diagnostics.push(
      diagnostic(
        "INVALID_LAYOUT_VALUE",
        "error",
        path,
        `Layout length must be finite${allowNegative ? "" : " and non-negative"}.`,
      ),
    );
  }
}

function validateRepeatedPlacements(located: LocatedScene, diagnostics: Diagnostic[]) {
  const pathsBySource = new Map<string, string>();
  walkSelectedNodes(located.scene.children, (node, path) => {
    if (node.kind !== "layer") return;
    const fullPath = `${located.path}.children${path}`;
    const previous = pathsBySource.get(node.sourceId);
    if (previous === undefined) {
      pathsBySource.set(node.sourceId, fullPath);
      return;
    }
    diagnostics.push(
      diagnostic(
        "V1_REPEATED_PLACEMENT",
        "error",
        fullPath,
        `Source '${node.sourceId}' is placed more than once in scene '${located.scene.id}'.`,
        [previous, fullPath],
      ),
    );
  });
}

function walkSelectedNodes(
  nodes: readonly LayoutNode[],
  visit: (node: LayoutNode, path: string) => void,
  prefix = "",
) {
  nodes.forEach((node, index) => {
    const path = `${prefix}[${String(index)}]`;
    visit(node, path);
    if (node.kind === "box") walkSelectedNodes(node.children, visit, `${path}.children`);
  });
}

function validateSceneCycles(
  scenes: readonly LocatedScene[],
  scenesById: ReadonlyMap<string, LocatedScene>,
  diagnostics: Diagnostic[],
) {
  const adjacency = new Map<string, Set<string>>();
  for (const located of scenes) {
    const references = new Set<string>();
    walkAllNodes(located.scene.children, (node) => {
      if (node.kind === "scene-layer" && scenesById.has(node.sceneId)) references.add(node.sceneId);
    });
    adjacency.set(located.scene.id, references);
  }

  const complete = new Set<string>();
  const active: string[] = [];
  const reported = new Set<string>();

  const visit = (id: string) => {
    if (complete.has(id)) return;
    const activeIndex = active.indexOf(id);
    if (activeIndex >= 0) {
      const cycle = [...active.slice(activeIndex), id];
      const key = [...new Set(cycle)].sort().join("|");
      if (!reported.has(key)) {
        reported.add(key);
        const located = scenesById.get(id);
        diagnostics.push(
          diagnostic(
            "SCENE_CYCLE",
            "error",
            located === undefined ? "broadcast" : `${located.path}.id`,
            `Nested scene cycle detected: ${cycle.join(" -> ")}.`,
            cycle,
          ),
        );
      }
      return;
    }

    active.push(id);
    for (const referenced of adjacency.get(id) ?? []) visit(referenced);
    active.pop();
    complete.add(id);
  };

  for (const located of scenes) visit(located.scene.id);
}

function walkAllNodes(nodes: readonly LayoutNode[], visit: (node: LayoutNode) => void) {
  for (const node of nodes) {
    visit(node);
    if (node.kind === "box") walkAllNodes(node.children, visit);
  }
}

function validateId(
  value: string,
  code: "INVALID_PROJECT_ID" | "INVALID_SCENE_ID" | "INVALID_SOURCE_ID" | "INVALID_LAYER_ID",
  path: string,
  diagnostics: Diagnostic[],
) {
  if (!isStableId(value)) {
    diagnostics.push(
      diagnostic(
        code,
        "error",
        path,
        "ID must start with an alphanumeric character and contain only letters, numbers, '.', '_' or '-'.",
      ),
    );
  }
}
