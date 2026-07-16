import type { AssetRef } from "./assets.js";
import type { Size } from "./geometry.js";
import type { SourceId } from "./ids.js";

export const DEFAULT_BROWSER_SOURCE_CSS =
  "body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }";

export interface SourceBase {
  readonly id: SourceId;
  readonly label?: string;
}

/** Structural source contract carried through snapshots for built-in and extension kinds. */
export interface AnySourceDefinition extends SourceBase {
  readonly kind: `source:${string}`;
}

export interface ImageSource extends AnySourceDefinition {
  readonly kind: "source:image";
  readonly asset: AssetRef;
  readonly size?: Size;
}

export interface MediaFileSource extends AnySourceDefinition {
  readonly kind: "source:media-file";
  readonly asset: AssetRef;
  readonly size?: Size;
  readonly loop?: boolean;
  readonly muted?: boolean;
  readonly playbackRate?: number;
}

export interface BrowserSource extends AnySourceDefinition {
  readonly kind: "source:browser";
  readonly url: string;
  readonly viewport: Size;
  readonly shutdownWhenHidden?: boolean;
}

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

export type SourceKind = keyof SourceKinds;
export type SourceDefinition = SourceKinds[SourceKind];
