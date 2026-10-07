import type { CompiledSnapshot } from "@strangecyan/vignette-core";

/** A compiled snapshot with asset locations resolved relative to its source. */
export interface LoadedSnapshot {
  readonly snapshot: CompiledSnapshot;
  readonly assetUrls: Readonly<Record<string, string>>;
  readonly assetBaseUrl?: string;
  /** Base for root-relative snapshot URLs: `--base-url`, else the snapshot URL. */
  readonly baseUrl?: string;
  readonly localAssetRoot?: string;
}

/** Options controlling snapshot loading, scene selection, and PNG output. */
export interface PreviewOptions {
  readonly snapshot: string;
  readonly scene?: string;
  readonly name?: string;
  readonly out?: string;
  readonly allScenes: boolean;
  readonly timeoutMs: number;
  readonly json: boolean;
  readonly baseUrl?: string;
}

/** Metadata describing one rendered scene preview. */
export interface PreviewResult {
  readonly sceneId: string;
  readonly revision: number;
  readonly path: string;
  readonly placeholderCount: number;
}

export interface BrowserPreviewInput {
  readonly snapshot: CompiledSnapshot;
  readonly sceneId: string;
  readonly assetUrls: Readonly<Record<string, string>>;
  readonly assetBaseUrl?: string;
  readonly baseUrl?: string;
}

export interface BrowserPreviewResult {
  readonly placeholderCount: number;
}
