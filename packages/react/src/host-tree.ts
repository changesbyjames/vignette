import type {
  BroadcastNode,
  LayerNode,
  LayoutNode,
  SceneLayerNode,
  SceneNode,
  SourceDefinition,
  SourcesNode,
} from "@cbj/react-obs-core";

import type { HostContainer, HostNode, HostType } from "./host-types.js";

let nextHostId = 1;

export function createHostNode(type: HostType, props: Readonly<Record<string, unknown>>): HostNode {
  return {
    hostId: nextHostId++,
    type,
    props: sanitizeProps(props),
    parent: null,
    children: [],
    hidden: false,
  };
}

export function updateHostNode(node: HostNode, props: Readonly<Record<string, unknown>>): void {
  node.props = sanitizeProps(props);
}

export function appendHostChild(parent: HostNode | HostContainer, child: HostNode): void {
  insertHostChild(parent, child, undefined);
}

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
  const children = rootChildren.map((child, index) => {
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
  });
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

function toSource(node: HostNode): SourceDefinition {
  if (node.type !== "source") throw new Error(`<${node.type}> is not valid inside <Sources>.`);
  const definition = required(node.props, "definition") as SourceDefinition;
  if (typeof definition.kind !== "string" || typeof definition.id !== "string") {
    throw new Error("A <Source> definition must declare 'kind' and 'id'.");
  }
  return definition;
}

function toScene(node: HostNode): SceneNode {
  return {
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
      return {
        kind: "box",
        ...optionalProps(props, ["style"]),
        children: visibleChildren(node).map(toLayout),
      };
    case "layer":
    case "browser-view":
      return {
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
      return {
        kind: "scene-layer",
        id: required(props, "id"),
        sceneId: required(props, "sceneId"),
        ...optionalProps(props, ["style", "visible", "opacity", "rotation"]),
      } as SceneLayerNode;
    default:
      throw new Error(`<${node.type}> is not a layout primitive.`);
  }
}

function collectBrowserViewSources(node: HostNode): readonly SourceDefinition[] {
  if (node.type === "browser-view") {
    return [
      {
        kind: "source:browser",
        id: required(node.props, "sourceId"),
        url: required(node.props, "url"),
        viewport: required(node.props, "viewport"),
        ...optionalProps(node.props, ["label", "shutdownWhenHidden"]),
      } as SourceDefinition,
    ];
  }
  return visibleChildren(node).flatMap(collectBrowserViewSources);
}

function sanitizeProps(
  props: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === "children" || key === "key" || key === "ref" || value === undefined) continue;
    result[key] = value;
  }
  return result;
}

function optionalProps(
  props: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) if (props[key] !== undefined) result[key] = props[key];
  return result;
}

function required(props: Readonly<Record<string, unknown>>, key: string): unknown {
  const value = props[key];
  if (value === undefined) throw new Error(`Host primitive is missing required prop '${key}'.`);
  return value;
}

function visibleChildren(parent: HostNode | HostContainer): readonly HostNode[] {
  return parent.children.filter((child) => !child.hidden);
}

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
