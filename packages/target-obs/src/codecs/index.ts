import { browserCodec } from "./browser.js";
import { colorCodec } from "./color.js";
import { imageCodec } from "./image.js";
import { mediaCodec } from "./media.js";
import type { ObsSourceCodec } from "./types.js";

/** Source codecs available without registering extensions. */
export const BUILTIN_OBS_CODECS: readonly ObsSourceCodec[] = [
  imageCodec,
  mediaCodec,
  browserCodec,
  colorCodec,
];

/** OBS source codecs indexed by source kind. */
export type ObsCodecMap = ReadonlyMap<`source:${string}`, ObsSourceCodec>;

/** Merges extension codecs over the built-in ones. Later entries win per kind. */
export function resolveObsCodecs(extensions: readonly ObsSourceCodec[] = []): ObsCodecMap {
  const codecs = new Map<`source:${string}`, ObsSourceCodec>();
  for (const codec of [...BUILTIN_OBS_CODECS, ...extensions]) codecs.set(codec.kind, codec);
  return codecs;
}

export { browserCodec, colorCodec, imageCodec, mediaCodec };
export { selectInputKind } from "./types.js";
export type { ObsCodecContext, ObsCodecResult, ObsSourceCodec } from "./types.js";
