import type { AssetRef } from "./assets.js";
import type { Size } from "./geometry.js";
import type { SourceId } from "./ids.js";

/** CSS injected into browser sources to create a transparent fixed viewport. */
export const DEFAULT_BROWSER_SOURCE_CSS =
  "body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }";

/** Identity and optional label shared by every source definition. */
export interface SourceBase {
  readonly id: SourceId;
  readonly label?: string;
}

/** Structural source contract carried through snapshots for built-in and extension kinds. */
export interface AnySourceDefinition extends SourceBase {
  readonly kind: `source:${string}`;
}

/** Image asset that can optionally declare its intrinsic dimensions. */
export interface ImageSource extends AnySourceDefinition {
  readonly kind: "source:image";
  readonly asset: AssetRef;
  readonly size?: Size;
}

/** Local media asset and its stable playback settings. */
export interface MediaFileSource extends AnySourceDefinition {
  readonly kind: "source:media-file";
  readonly asset: AssetRef;
  readonly size?: Size;
  readonly loop?: boolean;
  readonly muted?: boolean;
  readonly playbackRate?: number;
}

/** HTTP browser source with a fixed viewport. */
export interface BrowserSource extends AnySourceDefinition {
  readonly kind: "source:browser";
  readonly url: string;
  readonly viewport: Size;
  readonly shutdownWhenHidden?: boolean;
}

/** Solid color source with optional intrinsic dimensions. */
export interface ColorSource extends AnySourceDefinition {
  readonly kind: "source:color";
  readonly color: string;
  readonly size?: Size;
}

/** Closed registry of built-in source kinds. Extensions carry their source type explicitly. */
export interface SourceKinds {
  "source:image": ImageSource;
  "source:media-file": MediaFileSource;
  "source:browser": BrowserSource;
  "source:color": ColorSource;
}

/** Discriminator of a built-in source definition. */
export type SourceKind = keyof SourceKinds;
/** Union of all built-in source definitions. */
export type SourceDefinition = SourceKinds[SourceKind];
