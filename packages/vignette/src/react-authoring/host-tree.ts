import type { HostContainer, HostNode, HostProps, HostType } from "./host-types.js";

let nextHostId = 1;

/** Creates a detached host node. React pairs each host `type` with the props its element rendered. */
export function createHostNode(type: HostType, props: HostProps): HostNode {
  // SAFETY: Host elements are created only by the components in elements.tsx and define-source.ts, which pair each type with its props.
  return {
    hostId: nextHostId++,
    type,
    props: sanitizeProps(props),
    parent: null,
    children: [],
    hidden: false,
  } as HostNode;
}

/** Replaces a node's props after a commit; React never changes a mounted node's type. */
export function updateHostNode(node: HostNode, props: HostProps): void {
  // SAFETY: React only updates a host instance with props rendered for the same element type.
  Object.assign(node, { props: sanitizeProps(props) });
}

/** Appends a child, detaching it from any previous parent. */
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

/** Detaches a child from its parent. */
export function removeHostChild(parent: HostNode | HostContainer, child: HostNode): void {
  const index = parent.children.indexOf(child);
  if (index < 0 || child.parent !== parent)
    throw new Error("Cannot remove a node from a non-parent.");
  parent.children.splice(index, 1);
  child.parent = null;
}

/** Detaches every child of a parent. */
export function clearHostChildren(parent: HostNode | HostContainer): void {
  for (const child of parent.children) child.parent = null;
  parent.children.splice(0);
}

/** React-only props are excluded from the host tree before it is lowered. */
function sanitizeProps(props: HostProps): HostProps {
  const result: HostProps & ReactOnlyProps = { ...props };
  delete result.children;
  delete result.ref;
  return result;
}

/** Props React passes to host instances that are not part of the show. */
interface ReactOnlyProps {
  children?: never;
  ref?: never;
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
