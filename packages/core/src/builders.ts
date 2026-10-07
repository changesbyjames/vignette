/**
 * Functional builders for creating a Vignette authoring graph without React.
 *
 * @module
 */
import type {
  BoxNode,
  BroadcastCanvas,
  BroadcastNode,
  LayerNode,
  LayoutNode,
  SceneLayerNode,
  SceneNode,
  SourcesNode,
} from "./authoring.js";
import type {
  BrowserSource,
  ColorSource,
  ImageSource,
  MediaFileSource,
  AnySourceDefinition,
} from "./sources.js";

interface BroadcastInput {
  readonly projectId: string;
  readonly canvas?: BroadcastCanvas;
  readonly children: readonly (SourcesNode | SceneNode)[];
}

interface SceneInput {
  readonly id: string;
  readonly label?: string;
  readonly children?: readonly LayoutNode[];
}

interface BoxInput {
  readonly children?: readonly LayoutNode[];
}

/** Builds the root authoring node with canvas defaults. IDs are validated when the graph compiles. */
export function broadcast(input: BroadcastInput): BroadcastNode {
  return {
    kind: "broadcast",
    projectId: input.projectId,
    canvas: input.canvas ?? { width: 1920, height: 1080, frameRate: 60 },
    children: input.children,
  };
}

/** Builds a collection of source definitions. */
export function sources(...children: readonly AnySourceDefinition[]): SourcesNode {
  return { kind: "sources", children };
}

/** Builds a scene node with an explicit ID. */
export function scene(input: SceneInput): SceneNode {
  return input.label === undefined
    ? { kind: "scene", id: input.id, children: input.children ?? [] }
    : { kind: "scene", id: input.id, label: input.label, children: input.children ?? [] };
}

/** Builds a virtual Yoga layout container. */
export function box(input: Omit<BoxNode, "kind" | "children"> & BoxInput = {}): BoxNode {
  return { kind: "box", ...input, children: input.children ?? [] };
}

/** Builds a source placement with explicit layer and source IDs. */
export function layer(input: Omit<LayerNode, "kind">): LayerNode {
  return { kind: "layer", ...input };
}

/** Builds a nested-scene placement with explicit layer and scene IDs. */
export function sceneLayer(input: Omit<SceneLayerNode, "kind">): SceneLayerNode {
  return { kind: "scene-layer", ...input };
}

/** Builds an image source. */
export function imageSource(input: Omit<ImageSource, "kind">): ImageSource {
  return { kind: "source:image", ...input };
}

/** Builds a media-file source. */
export function mediaSource(input: Omit<MediaFileSource, "kind">): MediaFileSource {
  return { kind: "source:media-file", ...input };
}

/** Builds a browser source. */
export function browserSource(input: Omit<BrowserSource, "kind">): BrowserSource {
  return { kind: "source:browser", ...input };
}

/** Builds a color source. */
export function colorSource(input: Omit<ColorSource, "kind">): ColorSource {
  return { kind: "source:color", ...input };
}
