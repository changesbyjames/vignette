/**
 * Browser hydration entrypoint for server-rendered Vignette frames.
 *
 * @module
 */
import { createElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";

import type { FrameDefinition } from "./definition.js";

/** Hydrates a server-rendered frame after validating its serialized parameters. */
export function hydrateFrame<Params extends object>(
  definition: FrameDefinition<Params>,
  input: unknown,
): Root {
  const container = document.querySelector<HTMLElement>("[data-vignette-frame-root]");
  if (container === null) throw new Error("Frame document is missing its hydration root.");
  const params = definition.params.parse(input);
  return hydrateRoot(container, createElement(definition.view, params));
}
