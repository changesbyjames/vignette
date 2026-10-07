/**
 * React authoring primitives and the Node-side composer for target-neutral broadcast scenes.
 *
 * Composition files need only this package: it re-exports the core types and helpers authors use
 * (layout styles, geometry, canvas, assets, and snapshot/stream types returned by the composer).
 * `@strangecyan/vignette-core` remains the low-level contract for target and extension authors.
 *
 * @module
 */
export * from "./composition.js";
export * from "./presets.js";
export * from "./primitives.js";
export * from "./root.js";
export * from "./source-element.js";
export type * from "./status.js";

export { asset } from "@strangecyan/vignette-core";
export type {
  Align,
  AnySourceDefinition,
  AssetManifest,
  AssetManifestEntry,
  AssetRef,
  BroadcastCanvas,
  CompiledSnapshot,
  ContentAlignment,
  DefiniteLength,
  Diagnostic,
  EdgeValues,
  Edges,
  FitMode,
  FlexDirection,
  HorizontalAlignment,
  Insets,
  JustifyContent,
  LayoutEngine,
  LayoutStyle,
  Length,
  Percentage,
  Size,
  SourceModule,
  StreamEvent,
  StreamMessage,
  VerticalAlignment,
} from "@strangecyan/vignette-core";
