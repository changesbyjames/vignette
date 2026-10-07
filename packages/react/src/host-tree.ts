import { z } from "zod";
import { omitUndefined, type BoxNode } from "@strangecyan/vignette-core";
import type {
  BroadcastNode,
  LayerNode,
  LayoutNode,
  SceneLayerNode,
  SceneNode,
  AnySourceDefinition,
  SourcesNode,
} from "@strangecyan/vignette-core";

import type { HostContainer, HostNode, HostProps, HostType } from "./host-types.js";

let nextHostId = 1;

export function createHostNode(type: HostType, props: HostProps): HostNode {
  return {
    hostId: nextHostId++,
    type,
    props: sanitizeProps(props),
    parent: null,
    children: [],
    hidden: false,
  };
}

export function updateHostNode(node: HostNode, props: HostProps): void {
  node.props = sanitizeProps(props);
}

export function appendHostChild(parent: HostNode | HostContainer, child: HostNode): void {
  insertHostChild(parent, child, undefined);
}

/** Prevent cycles, detach the old parent, and insert the child before the requested sibling when present. */
export function insertHostChild(
  parent: HostNode | HostContainer,
  child: HostNode,
  before: HostNode | undefined,
): void {
  if (child === parent) throw new Error("A host node cannot contain itself.");
  if (isAncestor(child, parent))
    throw new Error("A host node cannot contain one of its ancestors.");
  if (before !== undefined && before.parent !== parent) {
    throw new Error("The insertion reference is not a child of the requested parent.");
  }

  if (child.parent !== null) {
    const previousIndex = child.parent.children.indexOf(child);
    if (previousIndex >= 0) child.parent.children.splice(previousIndex, 1);
  }
  const index = before === undefined ? parent.children.length : parent.children.indexOf(before);
  parent.children.splice(index, 0, child);
  child.parent = parent;
}

export function removeHostChild(parent: HostNode | HostContainer, child: HostNode): void {
  const index = parent.children.indexOf(child);
  if (index < 0 || child.parent !== parent)
    throw new Error("Cannot remove a node from a non-parent.");
  parent.children.splice(index, 1);
  child.parent = null;
}

export function clearHostChildren(parent: HostNode | HostContainer): void {
  for (const child of parent.children) child.parent = null;
  parent.children.splice(0);
}

/** Find the authoring root and collect embedded sources before converting visible children to the broadcast graph. */
export function hostTreeToBroadcast(container: HostContainer): BroadcastNode {
  const root = visibleChildren(container).find((node) => node.type === "broadcast");
  if (root === undefined) throw new Error("The renderer root must contain a <Broadcast> node.");
  if (visibleChildren(container).length !== 1) {
    throw new Error("The renderer root must contain exactly one <Broadcast> node.");
  }
  const rootChildren = visibleChildren(root);
  const embeddedSources = rootChildren.flatMap((child) =>
    child.type === "scene" ? collectBrowserViewSources(child) : [],
  );
  const sourcesIndex = rootChildren.findIndex((child) => child.type === "sources");
  const children = rootChildren.map(
    /** Merge embedded browser sources into the first explicit sources group without duplicating those definitions. */
    (child, index) => {
      if (child.type === "sources") {
        const sources = toSources(child);
        if (index !== sourcesIndex || embeddedSources.length === 0) return sources;
        return {
          kind: "sources" as const,
          children: [...sources.children, ...embeddedSources],
        };
      }
      if (child.type === "scene") return toScene(child);
      throw invalidChild(root, child);
    },
  );
  if (sourcesIndex < 0 && embeddedSources.length > 0) {
    children.unshift({ kind: "sources" as const, children: embeddedSources });
  }
  return {
    kind: "broadcast",
    projectId: container.projectId,
    canvas: { ...container.canvas },
    children,
  };
}

function toSources(node: HostNode): SourcesNode {
  const sources = visibleChildren(node).map(toSource);
  return { kind: "sources", children: sources };
}

function toSource(node: HostNode): AnySourceDefinition {
  if (node.type !== "source") throw new Error(`<${node.type}> is not valid inside <Sources>.`);
  const definition = required(node.props, "definition");
  if (!z.object({ kind: z.string(), id: z.string() }).safeParse(definition).success) {
    throw new Error("A <Source> definition must declare 'kind' and 'id'.");
  }
  // SAFETY: Shared identity fields were checked above; the registered core module validates kind-specific settings before publication.
  return definition as AnySourceDefinition;
}

function toScene(node: HostNode): SceneNode {
  return /* SAFETY: React props enter the authoring graph here; the core compiler validates their fields before publishing a snapshot. */ {
    kind: "scene",
    id: required(node.props, "id"),
    ...optionalProps(node.props, ["label"]),
    children: visibleChildren(node).map(toLayout),
  } as SceneNode;
}

function toLayout(node: HostNode): LayoutNode {
  const props = node.props;
  switch (node.type) {
    case "box":
      // SAFETY: The layout compiler validates box styles before publishing a snapshot.
      return {
        kind: "box",
        ...optionalProps(props, ["style"]),
        children: visibleChildren(node).map(toLayout),
      } as BoxNode;
    case "layer":
    case "browser-view":
      return /* SAFETY: React props enter the authoring graph here; the core compiler validates their fields before publishing a snapshot. */ {
        kind: "layer",
        id: required(props, "id"),
        sourceId: required(props, "sourceId"),
        ...optionalProps(props, [
          "style",
          "fit",
          "alignment",
          "crop",
          "visible",
          "opacity",
          "rotation",
        ]),
      } as LayerNode;
    case "scene-layer":
      return /* SAFETY: React props enter the authoring graph here; the core compiler validates their fields before publishing a snapshot. */ {
        kind: "scene-layer",
        id: required(props, "id"),
        sceneId: required(props, "sceneId"),
        ...optionalProps(props, ["style", "visible", "opacity", "rotation"]),
      } as SceneLayerNode;
    default:
      throw new Error(`<${node.type}> is not a layout primitive.`);
  }
}

function collectBrowserViewSources(node: HostNode): readonly AnySourceDefinition[] {
  if (node.type === "browser-view") {
    return [
      /* SAFETY: React props enter the authoring graph here; the core compiler validates their fields before publishing a snapshot. */ {
        kind: "source:browser",
        id: required(node.props, "sourceId"),
        url: required(node.props, "url"),
        viewport: required(node.props, "viewport"),
        ...optionalProps(node.props, ["label", "shutdownWhenHidden"]),
      } as AnySourceDefinition,
    ];
  }
  return visibleChildren(node).flatMap(collectBrowserViewSources);
}

/** React-only props are excluded from the graph before compiling it. */
function sanitizeProps(props: HostProps): HostProps {
  const result = { ...props };
  delete result.children;
  delete result.key;
  delete result.ref;
  return omitUndefined(result);
}

function optionalProps(props: HostProps, keys: readonly (keyof HostProps)[]): HostProps {
  const result = {};
  for (const key of keys) {
    if (props[key] !== undefined) Object.assign(result, { [key]: props[key] });
  }
  return result;
}

function required<K extends keyof HostProps>(props: HostProps, key: K): HostProps[K] {
  const value = props[key];
  if (value === undefined) throw new Error(`Host primitive is missing required prop '${key}'.`);
  return value;
}

function visibleChildren(parent: HostNode | HostContainer): readonly HostNode[] {
  return parent.children.filter((child) => !child.hidden);
}

/** Walk parent links until reaching the candidate ancestor or the root container. */
function isAncestor(node: HostNode, possibleDescendant: HostNode | HostContainer): boolean {
  let current = "parent" in possibleDescendant ? possibleDescendant.parent : null;
  while (current !== null && "parent" in current) {
    if (current === node) return true;
    current = current.parent;
  }
  return false;
}

function invalidChild(parent: HostNode, child: HostNode): Error {
  return new Error(`<${child.type}> is not valid inside <${parent.type}>.`);
}
