import {
  isRootRelativeUrl,
  requireBaseUrl,
  resolveResourceUrl,
  validateAssetName,
  validateResourceUrl,
  type AssetManifest,
  type AssetRef,
  type AssetResolver,
  type ResolvedAsset,
} from "@strangecyan/vignette-core";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

export interface AssetDownloadResponse {
  readonly ok: boolean;
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type AssetFetcher = (url: string) => Promise<AssetDownloadResponse>;

export interface ObsAssetStoreOptions {
  /**
   * Absolute HTTP(S) base for root-relative manifest URLs, as reachable from this process (the
   * asset downloader). Absolute manifest URLs are fetched unchanged.
   */
  readonly baseUrl?: string | undefined;
  readonly fetch?: AssetFetcher | undefined;
  readonly temporaryDirectory?: string | undefined;
}

export class ObsAssetStore implements AssetResolver {
  private readonly baseUrl: string | undefined;
  private readonly fetch: AssetFetcher;
  private readonly temporaryDirectory: string;
  private root: string | undefined;
  private files = new Map<string, string>();

  /** Validate an optional base URL eagerly and default the fetcher and temporary directory. */
  constructor(options: ObsAssetStoreOptions = {}) {
    this.baseUrl =
      options.baseUrl === undefined ? undefined : requireBaseUrl(options.baseUrl, "baseUrl");
    this.fetch = options.fetch ?? ((url) => fetch(url));
    this.temporaryDirectory = options.temporaryDirectory ?? tmpdir();
  }

  async setup(manifest: AssetManifest): Promise<void> {
    validateManifest(manifest, this.baseUrl);
    const root = await mkdtemp(join(this.temporaryDirectory, "vignette-assets-"));
    const files = new Map<string, string>();
    try {
      const downloads = await Promise.all(
        manifest.assets.map(async (entry) => {
          const response = await this.fetch(resolveResourceUrl(entry.url, this.baseUrl));
          if (!response.ok) {
            throw new Error(
              `Asset '${entry.name}' download failed with HTTP ${String(response.status)}.`,
            );
          }
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (entry.integrity !== undefined) verifyIntegrity(bytes, entry.integrity);
          return { name: entry.name, bytes };
        }),
      );
      for (const download of downloads) {
        const digest = createHash("sha256").update(download.name).digest("hex");
        const path = join(root, `${digest}${extname(download.name)}`);
        await writeFile(path, download.bytes);
        files.set(download.name, path);
      }
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      throw error;
    }

    const previousRoot = this.root;
    this.root = root;
    this.files = files;
    if (previousRoot !== undefined) await rm(previousRoot, { recursive: true, force: true });
  }

  resolve(asset: AssetRef): Promise<ResolvedAsset> {
    const path = this.files.get(asset.name);
    return path === undefined
      ? Promise.reject(new Error(`Asset '${asset.name}' is absent from the runtime manifest.`))
      : Promise.resolve({ kind: "file", path });
  }

  async dispose(): Promise<void> {
    const root = this.root;
    this.root = undefined;
    this.files.clear();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
}

/** Reject invalid or repeated asset names and verify each URL can be materialized for OBS. */
function validateManifest(manifest: AssetManifest, baseUrl: string | undefined): void {
  const names = new Set<string>();
  for (const entry of manifest.assets) {
    // Reject invalid or repeated asset names and verify each URL can be materialized for OBS.

    const error = validateAssetName(entry.name);
    if (error !== undefined) throw new Error(error);
    if (names.has(entry.name)) {
      throw new Error(`Asset manifest contains duplicate name '${entry.name}'.`);
    }
    names.add(entry.name);
    const urlError = validateResourceUrl(entry.url);
    if (urlError !== undefined) throw new Error(`Asset '${entry.name}' ${urlError}`);
    if (baseUrl === undefined && isRootRelativeUrl(entry.url)) {
      throw new Error(
        `Asset '${entry.name}' has root-relative URL '${entry.url}', but the OBS runtime has no baseUrl.`,
      );
    }
  }
}

function verifyIntegrity(bytes: Uint8Array, integrity: `sha256-${string}`): void {
  const actual = createHash("sha256").update(bytes).digest("base64");
  if (`sha256-${actual}` !== integrity)
    throw new Error("Downloaded asset failed its SHA-256 check.");
}
