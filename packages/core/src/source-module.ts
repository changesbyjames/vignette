import { validateAssetName, type AssetRef } from "./assets.js";
import { diagnostic, type Diagnostic } from "./diagnostics.js";
import { isFiniteNumber, isPositiveSize, type Size } from "./geometry.js";
import type { AnySourceDefinition, SourceKinds } from "./sources.js";

/**
 * Target-neutral behaviour for one source kind. Built-in kinds ship with core; extension
 * packages export their own module and pass it wherever sources are validated or compiled.
 */
export interface SourceModule<Source extends AnySourceDefinition = AnySourceDefinition> {
  readonly kind: Source["kind"];
  /** Intrinsic content size used by layout and content-fit calculations. */
  intrinsicSize(source: Source): Size | undefined;
  /** The asset this source needs resolved before a target can render it. */
  asset?(source: Source): AssetRef | undefined;
  /** Kind-specific validation; identity and placement checks are handled by core. */
  validate?(source: Source, path: string): readonly Diagnostic[];
}

/** Source modules indexed by their source-kind discriminator. */
export type SourceModuleMap = ReadonlyMap<string, SourceModule>;

/** Merges extension modules over the built-in ones. Later entries win per kind. */
export function resolveSourceModules(extensions: readonly SourceModule[] = []): SourceModuleMap {
  const modules = new Map<string, SourceModule>();
  for (const module of [...BUILTIN_SOURCE_MODULES, ...extensions]) modules.set(module.kind, module);
  return modules;
}

/** Diagnostic helper for module authors: `size` must be a finite positive size. */
export function invalidSourceSize(size: Size, path: string): Diagnostic | undefined {
  if (isPositiveSize(size)) return undefined;
  return diagnostic(
    "INVALID_SOURCE_SIZE",
    "error",
    path,
    "Source dimensions must be finite positive numbers.",
  );
}

/** Diagnostic helper for module authors: `url` must be an absolute HTTP(S) URL. */
export function invalidHttpUrl(url: string, path: string): Diagnostic | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return undefined;
  } catch {
    // Fall through to the diagnostic below.
  }
  return diagnostic(
    "INVALID_BROWSER_URL",
    "error",
    path,
    "Browser source URL must be an absolute HTTP(S) URL.",
  );
}

function invalidAsset(asset: AssetRef, path: string): Diagnostic | undefined {
  const message = validateAssetName(asset.name);
  if (message === undefined) return undefined;
  return diagnostic("INVALID_ASSET_NAME", "error", `${path}.asset.name`, message);
}

function compactDiagnostics(...items: readonly (Diagnostic | undefined)[]): readonly Diagnostic[] {
  return items.filter((item) => item !== undefined);
}

/** Built-in image-source validation and metadata behavior. */
export const imageSourceModule: SourceModule<SourceKinds["source:image"]> = {
  kind: "source:image",
  intrinsicSize: (source) => source.size,
  asset: (source) => source.asset,
  validate: (source, path) =>
    compactDiagnostics(
      invalidAsset(source.asset, path),
      source.size === undefined ? undefined : invalidSourceSize(source.size, `${path}.size`),
    ),
};

/** Built-in media-file validation and metadata behavior. */
export const mediaFileSourceModule: SourceModule<SourceKinds["source:media-file"]> = {
  kind: "source:media-file",
  intrinsicSize: (source) => source.size,
  asset: (source) => source.asset,
  validate: (source, path) =>
    compactDiagnostics(
      invalidAsset(source.asset, path),
      source.size === undefined ? undefined : invalidSourceSize(source.size, `${path}.size`),
      source.playbackRate !== undefined &&
        (!isFiniteNumber(source.playbackRate) || source.playbackRate <= 0)
        ? diagnostic(
            "INVALID_SOURCE_SETTING",
            "error",
            `${path}.playbackRate`,
            "Playback rate must be a finite positive number.",
          )
        : undefined,
    ),
};

/** Built-in browser-source validation and metadata behavior. */
export const browserSourceModule: SourceModule<SourceKinds["source:browser"]> = {
  kind: "source:browser",
  intrinsicSize: (source) => source.viewport,
  validate: (source, path) =>
    compactDiagnostics(
      invalidHttpUrl(source.url, `${path}.url`),
      invalidSourceSize(source.viewport, `${path}.viewport`),
    ),
};

/** Built-in color-source validation and metadata behavior. */
export const colorSourceModule: SourceModule<SourceKinds["source:color"]> = {
  kind: "source:color",
  intrinsicSize: (source) => source.size,
  validate: (source, path) =>
    compactDiagnostics(
      /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/u.test(source.color)
        ? undefined
        : diagnostic(
            "INVALID_SOURCE_SETTING",
            "error",
            `${path}.color`,
            "Color must use #RRGGBB or #RRGGBBAA notation.",
          ),
      source.size === undefined ? undefined : invalidSourceSize(source.size, `${path}.size`),
    ),
};

/** Source modules available without registering extensions. */
export const BUILTIN_SOURCE_MODULES: readonly SourceModule[] = [
  imageSourceModule,
  mediaFileSourceModule,
  browserSourceModule,
  colorSourceModule,
];
