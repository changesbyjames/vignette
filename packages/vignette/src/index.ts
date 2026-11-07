/**
 * Show primitives, source definitions, the snapshot model, the stream and the target contract.
 * Runs anywhere: nothing here imports Node, the DOM or OBS.
 *
 * @module
 */
export {
  Layer,
  Scene,
  Show,
  Use,
  type ChildrenProps,
  type LayerElementProps,
  type SceneProps,
  type ShowProps,
  type UseProps,
} from "./react-authoring/elements.js";

export {
  defineSource,
  type HasSourceDefinition,
  type SourceComponent,
  type SourceComponentProps,
  type SourceDefinition,
  type SourceDefinitionOf,
  type SourceIdProp,
  type SourcePropsOf,
  type SourcePropsSchemaType,
  type SourceSizeContext,
} from "./core/define-source.js";
export { Browser } from "./core/sources/browser.js";
export { Color } from "./core/sources/color.js";
export {
  Frame,
  type FrameBaseProps,
  type FrameParamsParser,
  type FrameProps,
  type FrameReference,
  type OptionalFrameParams,
  type RequiredFrameParams,
} from "./core/sources/frame.js";
export { Image } from "./core/sources/image.js";
export { Text } from "./core/sources/text.js";
export { Video } from "./core/sources/video.js";

export * from "./core/snapshot.js";
export * from "./core/assets.js";
export * from "./core/geometry.js";
export { isStableId, STABLE_ID_RULE, StableIdSchema, type StableId } from "./core/ids.js";
export type { Diagnostic, DiagnosticCode, DiagnosticSeverity } from "./core/diagnostics.js";
export type { LayoutEngine, LayoutRecord } from "./core/layout/layout-engine.js";
export { loadYoga } from "./core/layout/load-yoga.js";

export * from "./stream/index.js";
export * from "./target/index.js";

export {
  compose,
  type Bootstrap,
  type ComposeOptions,
  type Composer,
  type ComposerPhase,
  type ComposerStatus,
} from "./compose/compose.js";
