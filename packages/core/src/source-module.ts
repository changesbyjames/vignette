import { validateAssetName, type AssetRef } from "./assets.js";
import { diagnostic, type Diagnostic } from "./diagnostics.js";
import { isFiniteNumber, isPositiveSize, type Size } from "./geometry.js";
import { omitUndefined } from "./objects.js";
import { validateResourceUrl } from "./resource-url.js";
import type { ExtensionSourceKind } from "./stream.js";
import type { AnySourceDefinition, SourceKinds } from "./sources.js";

/**
 * Module specifiers of the target entrypoints implementing an extension source kind, e.g.
 * `{ dom: "@strangecyan/vignette-moq/dom", obs: "@strangecyan/vignette-moq/obs" }`. Targets name
 * them in diagnostics when a stream requires a kind they have not registered.
 */
export interface SourceModuleEntrypoints {
  readonly dom?: string;
  readonly obs?: string;
}

/** Compilation context available when a module fills a source's context-dependent defaults. */
export interface SourceDefaultsContext {
  /** The composition canvas size. */
  readonly canvas: Size;
  /** Rounded frame sizes of every layer that places the source, in scene order. */
  readonly layerSizes: readonly Size[];
  /** Authoring path of the source, for diagnostics. */
  readonly path: string;
}

interface SourceDefaultsApplied<Source extends AnySourceDefinition> {
  readonly ok: true;
  readonly source: Source;
}

interface SourceDefaultsFailure {
  readonly ok: false;
  readonly diagnostics: readonly Diagnostic[];
}

/** A source with its defaults filled in, or diagnostics explaining why they cannot be derived. */
export type SourceDefaultsResult<Source extends AnySourceDefinition> =
  | SourceDefaultsApplied<Source>
  | SourceDefaultsFailure;

/**
 * Target-neutral behaviour for one source kind. Built-in kinds ship with core; extension
 * packages export their own module and pass it wherever sources are validated or compiled.
 */
export interface SourceModule<Source extends AnySourceDefinition = AnySourceDefinition> {
  readonly kind: Source["kind"];
  /** Where targets import their implementation of this kind; advertised in the runtime setup. */
  readonly entrypoints?: SourceModuleEntrypoints;
  /**
   * Fills defaults that depend on the canvas or on the layers placing the source. Runs after
   * layout and before `intrinsicSize` and `asset`; compiled snapshots carry the returned definition.
   */
  applyDefaults?(source: Source, context: SourceDefaultsContext): SourceDefaultsResult<Source>;
  /** Intrinsic content size used by content-fit calculations. */
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

/** Extension kinds to advertise in a runtime setup, one per kind with the last module winning. */
export function extensionSourceKinds(
  extensions: readonly SourceModule[] = [],
): readonly ExtensionSourceKind[] {
  const kinds = new Map<string, ExtensionSourceKind>();
  for (const module of extensions) {
    kinds.set(module.kind, {
      kind: module.kind,
      ...omitUndefined({
        entrypoints: module.entrypoints === undefined ? undefined : { ...module.entrypoints },
      }),
    });
  }
  return [...kinds.values()];
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

/**
 * Diagnostic helper for module authors: `url` must be an absolute HTTP(S) URL or a root-relative
 * path (e.g. `/__vignette/frame/...`) that each target resolves against its own base URL.
 */
export function invalidResourceUrl(url: string, path: string): Diagnostic | undefined {
  const message = validateResourceUrl(url);
  if (message === undefined) return undefined;
  return diagnostic("INVALID_BROWSER_URL", "error", path, `Browser source ${message}`);
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
  validate:
    /** Validate the media asset, optional size, and finite positive playback rate as independent diagnostics. */
    (source, path) =>
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
  /** An omitted viewport takes the frame size of the layers placing the source (they must agree). */
  applyDefaults: (source, context) => {
    if (source.viewport !== undefined) return { ok: true, source };
    const sizes = distinctSizes(context.layerSizes);
    if (sizes.length > 1) {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            "INVALID_SOURCE_SIZE",
            "error",
            `${context.path}.viewport`,
            `Browser source '${source.id}' has no viewport and is placed at different sizes (${sizes.map(formatSize).join(", ")}); declare a viewport or use one source per size.`,
            [source.id],
          ),
        ],
      };
    }
    return { ok: true, source: { ...source, viewport: { ...(sizes[0] ?? context.canvas) } } };
  },
  intrinsicSize: (source) => source.viewport,
  validate: (source, path) =>
    compactDiagnostics(
      invalidResourceUrl(source.url, `${path}.url`),
      source.viewport === undefined
        ? undefined
        : invalidSourceSize(source.viewport, `${path}.viewport`),
    ),
};

/** Built-in color-source validation and metadata behavior. */
export const colorSourceModule: SourceModule<SourceKinds["source:color"]> = {
  kind: "source:color",
  /** An omitted size defaults to the canvas size, matching OBS's own color-source default. */
  applyDefaults: (source, context) => ({
    ok: true,
    source: source.size === undefined ? { ...source, size: { ...context.canvas } } : source,
  }),
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

function distinctSizes(sizes: readonly Size[]): Size[] {
  const result: Size[] = [];
  for (const size of sizes) {
    if (!result.some((seen) => seen.width === size.width && seen.height === size.height)) {
      result.push(size);
    }
  }
  return result;
}

function formatSize(size: Size): string {
  return `${String(size.width)}x${String(size.height)}`;
}

/** Source modules available without registering extensions. */
export const BUILTIN_SOURCE_MODULES: readonly SourceModule[] = [
  imageSourceModule,
  mediaFileSourceModule,
  browserSourceModule,
  colorSourceModule,
];
