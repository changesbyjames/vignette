import type { z } from "zod";

import { PLAIN_LAYER_KIND, type LayerDefinition, type LayerInput } from "../core/define-layer.js";
import type { SourceDefinition } from "../core/define-source.js";
import type { Size } from "../core/geometry.js";
import { diagnostic, type Diagnostic, type DiagnosticCode } from "../core/diagnostics.js";
import { isStableId, STABLE_ID_RULE } from "../core/ids.js";
import type {
  GroupLayoutNode,
  InlineSource,
  LayoutNode,
  ShowTree,
  ShowTreeScene,
  SourceRef,
} from "../core/show-tree.js";
import {
  CanvasSchema,
  LayerPropsSchema,
  LayoutStyleSchema,
  type Canvas,
  type LayerProps,
  type LayoutStyle,
  type Source,
  type SourceProps,
} from "../core/snapshot.js";
import type {
  HostContainer,
  HostNode,
  LayerHostNode,
  SceneHostNode,
  ShowHostNode,
  SourceHostNode,
} from "./host-types.js";

/**
 * The host tree lowered into compiler input. `tree` is absent when the root is not one valid
 * `<Show>`; otherwise invalid parts are dropped from it and reported in `diagnostics`.
 * `definitions` holds every source kind the show renders, keyed by kind.
 */
export interface LoweredShow {
  readonly tree?: ShowTree;
  readonly definitions: ReadonlyMap<string, SourceDefinition>;
  readonly diagnostics: readonly Diagnostic[];
}

/** State shared by one lowering pass. */
interface LowerContext {
  /** The canvas size alone, as kinds' `size` functions see it (no frame rate). */
  readonly canvas: Size;
  readonly definitions: Map<string, SourceDefinition>;
  readonly diagnostics: Diagnostic[];
}

/**
 * Where a layer sits: its scene, and whether its ID is rooted at the scene ID because neither it
 * nor any ancestor layer has an explicit `id`.
 */
interface LayerScope {
  readonly sceneId: string;
  readonly rooted: boolean;
}

/** The fields every lowered layer has, whether it groups layers or places a source. */
type LayerBase = Pick<GroupLayoutNode, "id" | "style" | "layer" | "kind" | "props">;

/** A scene fills the canvas; its root is the flex container of the scene's layers. */
const SCENE_STYLE: LayoutStyle = { width: "100%", height: "100%" };

/**
 * Walks the host tree once and produces the compiler's input. Layer IDs are the explicit `id` or
 * `<parentId>.<index>` among layer siblings, rooted at the scene ID (`main.0.1`). An inline source
 * takes its layer's ID; because source IDs are show-scoped and layer IDs scene-scoped, a layer ID
 * not rooted at the scene ID (an explicit one, or one derived below it) is qualified with the
 * scene (`main.camera`, `main.camera.0`) when it names the inline source.
 */
export function lowerShow(container: HostContainer): LoweredShow {
  const definitions = new Map<string, SourceDefinition>();
  const diagnostics: Diagnostic[] = [];
  const [root, ...rest] = container.children;
  if (root?.type !== "show" || rest.length > 0) {
    diagnostics.push(
      diagnostic("INVALID_TREE", "error", "show", "A show renders exactly one <Show> at its root."),
    );
    return { definitions, diagnostics };
  }
  const canvas = showIdentity(root, diagnostics);
  if (canvas === undefined) return { definitions, diagnostics };

  const context: LowerContext = {
    canvas: { width: canvas.width, height: canvas.height },
    definitions,
    diagnostics,
  };
  const sharedSources: Source[] = [];
  const scenes: ShowTreeScene[] = [];
  for (const child of visible(root.children)) {
    if (child.type === "scene") pushDefined(scenes, lowerScene(child, context));
    else if (child.type === "source") pushDefined(sharedSources, lowerSharedSource(child, context));
    else misplaced(child, "show", "<Show> holds only scenes and shared sources.", context);
  }
  const tree: ShowTree = {
    id: root.props.id,
    canvas,
    activeScene: root.props.activeScene,
    sharedSources,
    scenes,
  };
  return { tree, definitions, diagnostics };
}

/** Validates the show's ID and canvas; without both nothing else can be lowered. */
function showIdentity(node: ShowHostNode, diagnostics: Diagnostic[]): Canvas | undefined {
  const idValid = isStableId(node.props.id);
  if (!idValid) diagnostics.push(diagnostic("INVALID_SHOW_ID", "error", "show.id", STABLE_ID_RULE));
  const canvas = CanvasSchema.safeParse(node.props.canvas);
  if (!canvas.success) pushIssues(diagnostics, "INVALID_CANVAS", "show.canvas", canvas.error);
  return idValid && canvas.success ? canvas.data : undefined;
}

function lowerScene(node: SceneHostNode, context: LowerContext): ShowTreeScene | undefined {
  const id = node.props.id;
  if (!isStableId(id)) {
    context.diagnostics.push(diagnostic("INVALID_SCENE_ID", "error", "scene", STABLE_ID_RULE));
    return undefined;
  }
  const scope: LayerScope = { sceneId: id, rooted: true };
  const children = lowerLayers(node.children, id, `scene.${id}`, scope, context);
  const root = { id, style: SCENE_STYLE, layer: {}, kind: PLAIN_LAYER_KIND, props: {}, children };
  return { id, root };
}

/**
 * Lowers the layers under a scene or group layer. Siblings are indexed among layers only, and
 * hidden layers keep their index, so a suspended layer does not shift its siblings' IDs.
 */
function lowerLayers(
  nodes: readonly HostNode[],
  parentId: string,
  parentPath: string,
  scope: LayerScope,
  context: LowerContext,
): LayoutNode[] {
  const lowered: LayoutNode[] = [];
  let index = 0;
  for (const node of nodes) {
    if (node.type !== "layer") {
      if (!node.hidden) misplaced(node, parentPath, "A scene holds only layers.", context);
      continue;
    }
    pushDefined(lowered, lowerLayer(node, `${parentId}.${String(index)}`, scope, context));
    index += 1;
  }
  return lowered;
}

/** A layer with a source child places it; otherwise it groups its layer children. */
function lowerLayer(
  node: LayerHostNode,
  derivedId: string,
  parentScope: LayerScope,
  context: LowerContext,
): LayoutNode | undefined {
  const { id: explicitId, style, definition, props: kindInput, ...presentation } = node.props;
  const id = explicitId ?? derivedId;
  const path = `scene.${parentScope.sceneId}.layer.${id}`;
  if (!isStableId(id)) {
    context.diagnostics.push(diagnostic("INVALID_LAYER_ID", "error", path, STABLE_ID_RULE));
    return undefined;
  }
  const scope: LayerScope = {
    sceneId: parentScope.sceneId,
    rooted: parentScope.rooted && explicitId === undefined,
  };
  const parsedStyle = parseInto(LayoutStyleSchema, style ?? {}, `${path}.style`, context);
  const parsedLayer = parseInto(LayerPropsSchema, presentation, path, context);
  const kind = lowerKind(definition, kindInput, path, context);
  const base = layerBase(id, node, style === undefined ? undefined : parsedStyle, parsedLayer, {
    kind: definition?.kind ?? PLAIN_LAYER_KIND,
    props: kind ?? {},
  });
  // Lower the contents even when this layer's props are invalid, so every problem is reported.
  const lowered = lowerContents(node, base, scope, context);
  const invalid = [parsedStyle, parsedLayer, kind].some((part) => part === undefined);
  return invalid ? undefined : lowered;
}

/** The lowered layer's own fields. Suspense hides a layer rather than removing it: it keeps its identity and hides its content. */
function layerBase(
  id: string,
  node: LayerHostNode,
  style: LayoutStyle | undefined,
  parsedLayer: LayerProps | undefined,
  kind: Pick<LayerBase, "kind" | "props">,
): LayerBase {
  const layer = node.hidden ? { ...parsedLayer, visible: false } : (parsedLayer ?? {});
  return { id, style, layer, ...kind };
}

/** A `defineLayer` component's own props, validated by its kind's schema like a source's. */
function lowerKind(
  definition: LayerDefinition | undefined,
  input: LayerInput | undefined,
  path: string,
  context: LowerContext,
): SourceProps | undefined {
  if (definition === undefined) return {};
  const parsed = parseInto(definition.props, input ?? {}, path, context);
  // SAFETY: A kind's props schema describes JSON data (LayerDefinition contract); the snapshot carries its output unchanged.
  return parsed === undefined ? undefined : (parsed as SourceProps);
}

/** A layer with a visible source or `<Use>` child places it; otherwise it groups its layers. */
function lowerContents(
  node: LayerHostNode,
  base: LayerBase,
  scope: LayerScope,
  context: LowerContext,
): LayoutNode | undefined {
  const placements = node.children.filter(
    (child) => (child.type === "source" || child.type === "use") && !child.hidden,
  );
  if (placements.length > 0) return placeSource(node, placements, base.id, scope, context, base);
  const path = `scene.${scope.sceneId}.layer.${base.id}`;
  return { ...base, children: lowerLayers(node.children, base.id, path, scope, context) };
}

/** Lowers a layer's one `source` or `use` child, rejecting layers that also hold layers. */
function placeSource(
  node: LayerHostNode,
  placements: readonly HostNode[],
  id: string,
  scope: LayerScope,
  context: LowerContext,
  base: LayerBase,
): LayoutNode | undefined {
  const path = `scene.${scope.sceneId}.layer.${id}`;
  for (const child of node.children) {
    if (child.type === "show" || child.type === "scene") {
      misplaced(child, path, "A layer holds layers or one source.", context);
    }
  }
  if (node.children.some((child) => child.type === "layer")) {
    context.diagnostics.push(
      diagnostic(
        "LAYER_HAS_BOTH",
        "error",
        path,
        `Layer '${id}' holds both a source and layers; a layer places one source or groups layers.`,
        [id],
      ),
    );
    return undefined;
  }
  const [placement, ...extra] = placements;
  if (placement === undefined || extra.length > 0) {
    context.diagnostics.push(
      diagnostic("INVALID_TREE", "error", path, `Layer '${id}' places more than one source.`, [id]),
    );
    return undefined;
  }
  const source = lowerPlacement(placement, inlineSourceId(id, scope), path, context);
  return source === undefined ? undefined : { ...base, source };
}

/** Layer IDs rooted at the scene ID are already unique in the show; others are qualified. */
function inlineSourceId(layerId: string, scope: LayerScope): string {
  return scope.rooted ? layerId : `${scope.sceneId}.${layerId}`;
}

/**
 * A `<Use>` becomes a reference; an inline source is validated against its kind and gets its
 * `size` bound to the canvas, with the layer's size supplied by the compiler.
 */
function lowerPlacement(
  node: HostNode,
  defaultId: string,
  path: string,
  context: LowerContext,
): InlineSource | SourceRef | undefined {
  if (node.type === "use") return { ref: node.props.source };
  if (node.type !== "source") return undefined;
  const id = node.props.id ?? defaultId;
  const definition = node.props.definition;
  const props = sourceProps(node, `${path}.source`, context);
  if (props === undefined || !validSourceId(id, `${path}.source`, context)) return undefined;
  const canvas = context.canvas;
  return {
    id,
    kind: definition.kind,
    props: props.json,
    size: (layer) => definition.size(props.parsed, { canvas, layer }),
  };
}

/** A source declared in `<Show>` must have an ID; it is sized without a layer. */
function lowerSharedSource(node: SourceHostNode, context: LowerContext): Source | undefined {
  const id = node.props.id;
  if (id === undefined) {
    context.diagnostics.push(
      diagnostic(
        "INVALID_SOURCE_ID",
        "error",
        "show.source",
        `A ${node.props.definition.kind} source declared in <Show> needs an id so <Use> can place it.`,
      ),
    );
    return undefined;
  }
  const path = `source.${id}`;
  const props = sourceProps(node, path, context);
  if (props === undefined || !validSourceId(id, path, context)) return undefined;
  const definition = node.props.definition;
  const size = definition.size(props.parsed, { canvas: context.canvas });
  return { id, kind: definition.kind, props: props.json, size };
}

/** A kind's props as its `size` function takes them and as the snapshot carries them. */
interface ParsedSourceProps {
  readonly parsed: z.output<SourceDefinition["props"]>;
  readonly json: SourceProps;
}

/** Records the kind and validates props with its schema. */
function sourceProps(
  node: SourceHostNode,
  path: string,
  context: LowerContext,
): ParsedSourceProps | undefined {
  const definition = node.props.definition;
  context.definitions.set(definition.kind, definition);
  const parsed = parseInto(definition.props, node.props.props, `${path}.props`, context);
  if (parsed === undefined) return undefined;
  // SAFETY: A kind's props schema describes JSON data (SourceDefinition contract); the snapshot carries its output unchanged.
  return { parsed, json: parsed as SourceProps };
}

function validSourceId(id: string, path: string, context: LowerContext): boolean {
  if (isStableId(id)) return true;
  context.diagnostics.push(diagnostic("INVALID_SOURCE_ID", "error", path, STABLE_ID_RULE, [id]));
  return false;
}

/** Parses with a zod schema, turning each issue into an `INVALID_PROPS` diagnostic. */
function parseInto<Schema extends z.ZodType>(
  schema: Schema,
  input: z.input<Schema>,
  path: string,
  context: LowerContext,
): z.output<Schema> | undefined {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  pushIssues(context.diagnostics, "INVALID_PROPS", path, result.error);
  return undefined;
}

function pushIssues(
  diagnostics: Diagnostic[],
  code: DiagnosticCode,
  path: string,
  error: z.ZodError,
): void {
  for (const issue of error.issues) {
    const issuePath = issue.path.map(String).join(".");
    diagnostics.push(
      diagnostic(code, "error", issuePath === "" ? path : `${path}.${issuePath}`, issue.message),
    );
  }
}

function misplaced(node: HostNode, path: string, hint: string, context: LowerContext): void {
  context.diagnostics.push(
    diagnostic("INVALID_TREE", "error", path, `<${elementName(node)}> cannot go here. ${hint}`),
  );
}

const ELEMENT_NAMES = {
  show: "Show",
  scene: "Scene",
  layer: "Layer",
  use: "Use",
} as const;

function elementName(node: HostNode): string {
  return node.type === "source" ? node.props.definition.kind : ELEMENT_NAMES[node.type];
}

/** Hidden scenes and shared sources (inside a suspended boundary) are absent until they reveal. */
function visible(nodes: readonly HostNode[]): HostNode[] {
  return nodes.filter((node) => !node.hidden);
}

function pushDefined<T>(target: T[], value: T | undefined): void {
  if (value !== undefined) target.push(value);
}
