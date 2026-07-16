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
import { layerId, projectId, sceneId, sourceId } from "./ids.js";
import type {
  BrowserSource,
  ColorSource,
  ImageSource,
  MediaFileSource,
  AnySourceDefinition,
} from "./sources.js";

/** Builds the root authoring node with validated project identity and canvas defaults. */
export function broadcast(input: {
  readonly projectId: string;
  readonly canvas?: BroadcastCanvas;
  readonly children: readonly (SourcesNode | SceneNode)[];
}): BroadcastNode {
  return {
    kind: "broadcast",
    projectId: projectId(input.projectId),
    canvas: input.canvas ?? { width: 1920, height: 1080, frameRate: 60 },
    children: input.children,
  };
}

/** Builds a collection of source definitions. */
export function sources(...children: readonly AnySourceDefinition[]): SourcesNode {
  return { kind: "sources", children };
}

/** Builds a scene node with a validated explicit ID. */
export function scene(input: {
  readonly id: string;
  readonly label?: string;
  readonly children?: readonly LayoutNode[];
}): SceneNode {
  return input.label === undefined
    ? { kind: "scene", id: sceneId(input.id), children: input.children ?? [] }
    : { kind: "scene", id: sceneId(input.id), label: input.label, children: input.children ?? [] };
}

/** Builds a virtual Yoga layout container. */
export function box(
  input: Omit<BoxNode, "kind" | "children"> & { readonly children?: readonly LayoutNode[] } = {},
): BoxNode {
  return { kind: "box", ...input, children: input.children ?? [] };
}

/** Builds a source placement with validated layer and source IDs. */
export function layer(
  input: Omit<LayerNode, "kind" | "id" | "sourceId"> & {
    readonly id: string;
    readonly sourceId: string;
  },
): LayerNode {
  return { kind: "layer", ...input, id: layerId(input.id), sourceId: sourceId(input.sourceId) };
}

/** Builds a nested-scene placement with validated IDs. */
export function sceneLayer(
  input: Omit<SceneLayerNode, "kind" | "id" | "sceneId"> & {
    readonly id: string;
    readonly sceneId: string;
  },
): SceneLayerNode {
  return { kind: "scene-layer", ...input, id: layerId(input.id), sceneId: sceneId(input.sceneId) };
}

/** Builds an image source with a validated source ID. */
export function imageSource(
  input: Omit<ImageSource, "kind" | "id"> & { readonly id: string },
): ImageSource {
  return { kind: "source:image", ...input, id: sourceId(input.id) };
}

/** Builds a media-file source with a validated source ID. */
export function mediaSource(
  input: Omit<MediaFileSource, "kind" | "id"> & { readonly id: string },
): MediaFileSource {
  return { kind: "source:media-file", ...input, id: sourceId(input.id) };
}

/** Builds a browser source with a validated source ID. */
export function browserSource(
  input: Omit<BrowserSource, "kind" | "id"> & { readonly id: string },
): BrowserSource {
  return { kind: "source:browser", ...input, id: sourceId(input.id) };
}

/** Builds a color source with a validated source ID. */
export function colorSource(
  input: Omit<ColorSource, "kind" | "id"> & { readonly id: string },
): ColorSource {
  return { kind: "source:color", ...input, id: sourceId(input.id) };
}
