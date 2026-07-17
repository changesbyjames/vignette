/**
 * Typed React DOM frame definitions and scene placement primitives.
 *
 * @module
 */
export {
  frame,
  isFrameDefinition,
  type FrameDefinition,
  type FrameMetadata,
  type FrameOptions,
  type FrameParamsSchema,
} from "./definition.js";
export {
  createSceneStore,
  SceneProvider,
  type SceneProviderProps,
  type SceneState,
  type SceneStore,
} from "./scene.js";
export { View, type ViewProps } from "./view.js";
