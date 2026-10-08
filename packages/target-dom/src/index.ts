/**
 * Browser DOM target, its stream-consuming `DOMRuntime`, and source renderers.
 *
 * @module
 */
export { DOMRuntime, type DOMRuntimeOptions } from "./runtime.js";
export { DomTarget, type DomTargetOptions } from "./dom-target.js";
export { sseStream } from "./sse.js";
export {
  BUILTIN_DOM_RENDERERS,
  browserRenderer,
  colorRenderer,
  imageRenderer,
  mediaRenderer,
  resolveDomRenderers,
  type DomRendererContext,
  type DomRendererMap,
  type DomSourceRenderer,
  type DomSourceView,
} from "./elements/index.js";
