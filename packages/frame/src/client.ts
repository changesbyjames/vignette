/**
 * Browser hydration entrypoint for server-rendered Vignette frames.
 *
 * @module
 */
import { hydrateRoot, type Root } from "react-dom/client";

import type { FrameDefinition, FrameParamsInput } from "./definition.js";
import { frameElement } from "./frame-element.js";

/**
 * Hydrates a server-rendered frame after validating its serialized parameters. The view renders
 * beneath a root Suspense boundary, matching the server render.
 */
export function hydrateFrame<Params extends object>(
  definition: FrameDefinition<Params>,
  input: FrameParamsInput<Params>,
): Root {
  const container = document.querySelector<HTMLElement>("[data-vignette-frame-root]");
  if (container === null) throw new Error("Frame document is missing its hydration root.");
  const params = definition.params.parse(input);
  return hydrateRoot(container, frameElement(definition, params));
}
