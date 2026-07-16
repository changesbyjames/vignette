/**
 * Browser DOM runtime and source renderers for compiled Vignette snapshots.
 *
 * @module
 */
export { DOMRuntime, type DOMRuntimeOptions } from "./runtime.js";
export { DomTarget, type DomTargetOptions } from "./dom-target.js";
export { sseRuntimeSource } from "./sse.js";
export {
  BUILTIN_DOM_RENDERERS,
  browserRenderer,
  colorRenderer,
  imageRenderer,
  mediaRenderer,
  resolveDomRenderers,
  type DomRendererMap,
  type DomSourceRenderer,
  type DomSourceView,
} from "./elements/index.js";
