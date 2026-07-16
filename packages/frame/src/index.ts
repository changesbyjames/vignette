/**
 * Typed React DOM frame definitions and scene placement primitives.
 *
 * @module
 */
export {
  frame,
  isFrameDefinition,
  type FrameDefinition,
  type FrameOptions,
  type FrameParamsSchema,
} from "./definition.js";
export {
  FrameProvider,
  FrameRegistrarProvider,
  View,
  type FrameProviderProps,
  type FrameRegistrar,
  type FrameRegistrarProviderProps,
  type ViewProps,
} from "./view.js";
