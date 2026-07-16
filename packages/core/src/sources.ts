import type { AssetRef } from "./assets.js";
import type { Size } from "./geometry.js";
import type { SourceId } from "./ids.js";

export const DEFAULT_BROWSER_SOURCE_CSS =
  "body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }";

export interface SourceBase {
  readonly id: SourceId;
  readonly label?: string;
}

export interface ImageSource extends SourceBase {
  readonly kind: "source:image";
  readonly asset: AssetRef;
  readonly size?: Size;
}

export interface MediaFileSource extends SourceBase {
  readonly kind: "source:media-file";
  readonly asset: AssetRef;
  readonly size?: Size;
  readonly loop?: boolean;
  readonly muted?: boolean;
  readonly playbackRate?: number;
}

export interface BrowserSource extends SourceBase {
  readonly kind: "source:browser";
  readonly url: string;
  readonly viewport: Size;
  readonly shutdownWhenHidden?: boolean;
}

export interface ColorSource extends SourceBase {
  readonly kind: "source:color";
  readonly color: string;
  readonly size?: Size;
}

/**
 * Open registry of source kinds. Extension packages contribute new kinds through TypeScript
 * module augmentation:
 *
 * ```ts
 * declare module "@cbj/react-obs-core" {
 *   interface SourceKinds {
 *     "source:example": ExampleSource;
 *   }
 * }
 * ```
 *
 * Every entry must extend {@link SourceBase} and carry a `kind` matching its key. Runtime
 * behaviour for a kind is registered separately as a {@link SourceModule}.
 */
export interface SourceKinds {
  "source:image": ImageSource;
  "source:media-file": MediaFileSource;
  "source:browser": BrowserSource;
  "source:color": ColorSource;
}

export type SourceKind = keyof SourceKinds;
export type SourceDefinition = SourceKinds[SourceKind];
