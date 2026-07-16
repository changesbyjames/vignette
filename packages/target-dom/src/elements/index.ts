import { browserRenderer } from "./browser.js";
import { colorRenderer } from "./color.js";
import { imageRenderer } from "./image.js";
import { mediaRenderer } from "./media.js";
import type { DomSourceRenderer } from "./types.js";

export const BUILTIN_DOM_RENDERERS: readonly DomSourceRenderer[] = [
  imageRenderer,
  mediaRenderer,
  browserRenderer,
  colorRenderer,
];

export type DomRendererMap = ReadonlyMap<`source:${string}`, DomSourceRenderer>;

/** Merges extension renderers over the built-in ones. Later entries win per kind. */
export function resolveDomRenderers(extensions: readonly DomSourceRenderer[] = []): DomRendererMap {
  const renderers = new Map<`source:${string}`, DomSourceRenderer>();
  for (const renderer of [...BUILTIN_DOM_RENDERERS, ...extensions]) {
    renderers.set(renderer.kind, renderer);
  }
  return renderers;
}

export { browserRenderer, colorRenderer, imageRenderer, mediaRenderer };
export type { DomSourceRenderer, DomSourceView } from "./types.js";
