import { createContext } from "react";
import type ReactReconciler from "react-reconciler";

import {
  appendHostChild,
  clearHostChildren,
  createHostNode,
  insertHostChild,
  removeHostChild,
  updateHostNode,
} from "./host-tree.js";
import type { HostContainer, HostNode, HostType } from "./host-types.js";

type Props = Readonly<Record<string, unknown>>;
type TimeoutHandle = ReturnType<typeof setTimeout>;
type NoTimeout = -1;
interface BroadcastHostContext {
  readonly renderer: "vignette";
}
type HostConfig = ReactReconciler.HostConfig<
  HostType,
  Props,
  HostContainer,
  HostNode,
  never,
  never,
  never,
  never,
  HostNode,
  BroadcastHostContext,
  never,
  TimeoutHandle,
  NoTimeout,
  null
>;
type RendererHostConfig = HostConfig & {
  readonly rendererVersion: string;
  readonly rendererPackageName: string;
  readonly extraDevToolsConfig: null;
  readonly cloneMutableInstance: (instance: HostNode) => HostNode;
  readonly cloneMutableTextInstance: () => never;
  readonly maySuspendCommitOnUpdate: () => false;
  readonly maySuspendCommitInSyncRender: () => false;
  readonly suspendOnActiveViewTransition: () => void;
  readonly getSuspendedCommitReason: () => null;
  readonly bindToConsole: (
    method: string,
    args: readonly unknown[],
    environmentName: string,
  ) => () => void;
  readonly supportsTestSelectors: false;
  readonly supportsResources: false;
  readonly supportsSingletons: false;
};

const DEFAULT_EVENT_PRIORITY = 0b0000000000000000000000000010000;
const HOST_CONTEXT: BroadcastHostContext = { renderer: "vignette" };
const hostTransitionContext = createContext(null) as unknown as HostConfig["HostTransitionContext"];
let currentUpdatePriority = DEFAULT_EVENT_PRIORITY;

export const hostConfig: RendererHostConfig = {
  rendererVersion: "0.0.0",
  rendererPackageName: "@strangecyan/vignette",
  extraDevToolsConfig: null,
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: false,
  warnsIfNotActing: true,
  supportsMicrotasks: true,
  noTimeout: -1,
  supportsTestSelectors: false,
  supportsResources: false,
  supportsSingletons: false,

  createInstance(type, props) {
    return createHostNode(type, props);
  },
  cloneMutableInstance(instance) {
    return instance;
  },
  createTextInstance() {
    throw new Error("Text is not supported by the broadcast renderer.");
  },
  cloneMutableTextInstance() {
    throw new Error("Text is not supported by the broadcast renderer.");
  },
  appendInitialChild(parent, child) {
    appendHostChild(parent, child);
  },
  finalizeInitialChildren() {
    return false;
  },
  shouldSetTextContent() {
    return false;
  },
  getRootHostContext() {
    return HOST_CONTEXT;
  },
  getChildHostContext(parentContext) {
    return parentContext;
  },
  getPublicInstance(instance) {
    return instance;
  },
  prepareForCommit(container) {
    if (container.commitActive) throw new Error("A broadcast renderer commit is already active.");
    container.commitActive = true;
    return null;
  },
  resetAfterCommit(container) {
    if (!container.commitActive) throw new Error("Broadcast commit bookkeeping is unbalanced.");
    container.commitActive = false;
    container.commitRevision += 1;
    container.onCommit(container.commitRevision);
  },
  preparePortalMount: noop,
  scheduleTimeout(callback, delay) {
    return setTimeout(callback, delay);
  },
  cancelTimeout(handle) {
    clearTimeout(handle);
  },
  scheduleMicrotask(callback) {
    queueMicrotask(callback);
  },

  appendChild(parent, child) {
    appendHostChild(parent, child);
  },
  appendChildToContainer(container, child) {
    appendHostChild(container, child);
  },
  insertBefore(parent, child, before) {
    insertHostChild(parent, child, before);
  },
  insertInContainerBefore(container, child, before) {
    insertHostChild(container, child, before);
  },
  removeChild(parent, child) {
    removeHostChild(parent, child);
  },
  removeChildFromContainer(container, child) {
    removeHostChild(container, child);
  },
  commitUpdate(instance, _type, _previous, next) {
    updateHostNode(instance, next);
  },
  commitMount: noop,
  resetTextContent: noop,
  hideInstance(instance) {
    instance.hidden = true;
  },
  unhideInstance(instance) {
    instance.hidden = false;
  },
  clearContainer(container) {
    clearHostChildren(container);
  },
  detachDeletedInstance: noop,

  getInstanceFromNode() {
    return null;
  },
  beforeActiveInstanceBlur: noop,
  afterActiveInstanceBlur: noop,
  prepareScopeUpdate: noop,
  getInstanceFromScope() {
    return null;
  },

  NotPendingTransition: null,
  HostTransitionContext: hostTransitionContext,
  setCurrentUpdatePriority(priority) {
    currentUpdatePriority = priority;
  },
  getCurrentUpdatePriority() {
    return currentUpdatePriority;
  },
  resolveUpdatePriority() {
    return currentUpdatePriority === 0 ? DEFAULT_EVENT_PRIORITY : currentUpdatePriority;
  },
  resetFormInstance: noop,
  requestPostPaintCallback(callback) {
    setTimeout(() => {
      callback(performance.now());
    }, 0);
  },
  shouldAttemptEagerTransition() {
    return false;
  },
  trackSchedulerEvent: noop,
  resolveEventType() {
    return null;
  },
  resolveEventTimeStamp() {
    return performance.now();
  },
  maySuspendCommit() {
    return false;
  },
  maySuspendCommitOnUpdate() {
    return false;
  },
  maySuspendCommitInSyncRender() {
    return false;
  },
  preloadInstance() {
    return true;
  },
  startSuspendingCommit: noop,
  suspendInstance: noop,
  suspendOnActiveViewTransition: noop,
  waitForCommitToBeReady() {
    return null;
  },
  getSuspendedCommitReason() {
    return null;
  },
  bindToConsole() {
    return noop;
  },
};

function noop(): void {
  return;
}
