import { createElement, Suspense, type ReactElement } from "react";

import type { FrameDefinition } from "./definition.js";

/**
 * The element both server rendering and hydration use for a frame. The root Suspense boundary
 * lets views suspend (for example `useRemoteStore` before its first snapshot) without their own
 * boundary: the server renders nothing for it and the browser renders the view once ready. The
 * fallback is empty so loading UI never covers program video.
 */
export function frameElement<Params extends object>(
  definition: FrameDefinition<Params>,
  params: Params,
): ReactElement {
  return createElement(Suspense, { fallback: null }, createElement(definition.view, params));
}
