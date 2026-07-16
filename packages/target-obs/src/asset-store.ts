import {
  validateAssetName,
  type AssetManifest,
  type AssetRef,
  type AssetResolver,
  type ResolvedAsset,
} from "@cbj/react-obs-core";
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
  readonly fetch?: AssetFetcher;
  readonly temporaryDirectory?: string;
}

export class ObsAssetStore implements AssetResolver {
  readonly #fetch: AssetFetcher;
  readonly #temporaryDirectory: string;
  #root: string | undefined;
  #files = new Map<string, string>();

  constructor(options: ObsAssetStoreOptions = {}) {
    this.#fetch = options.fetch ?? ((url) => fetch(url));
    this.#temporaryDirectory = options.temporaryDirectory ?? tmpdir();
  }

  async setup(manifest: AssetManifest): Promise<void> {
    validateManifest(manifest);
    const root = await mkdtemp(join(this.#temporaryDirectory, "react-obs-assets-"));
    const files = new Map<string, string>();
    try {
      const downloads = await Promise.all(
        manifest.assets.map(async (entry) => {
          const response = await this.#fetch(entry.url);
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

    const previousRoot = this.#root;
    this.#root = root;
    this.#files = files;
    if (previousRoot !== undefined) await rm(previousRoot, { recursive: true, force: true });
  }

  resolve(asset: AssetRef): Promise<ResolvedAsset> {
    const path = this.#files.get(asset.name);
    return path === undefined
      ? Promise.reject(new Error(`Asset '${asset.name}' is absent from the runtime manifest.`))
      : Promise.resolve({ kind: "file", path });
  }

  async dispose(): Promise<void> {
    const root = this.#root;
    this.#root = undefined;
    this.#files.clear();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
}

function validateManifest(manifest: AssetManifest): void {
  const names = new Set<string>();
  for (const entry of manifest.assets) {
    const error = validateAssetName(entry.name);
    if (error !== undefined) throw new Error(error);
    if (names.has(entry.name)) {
      throw new Error(`Asset manifest contains duplicate name '${entry.name}'.`);
    }
    names.add(entry.name);
    const url = new URL(entry.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`Asset '${entry.name}' URL must use HTTP(S).`);
    }
  }
}

function verifyIntegrity(bytes: Uint8Array, integrity: `sha256-${string}`): void {
  const actual = createHash("sha256").update(bytes).digest("base64");
  if (`sha256-${actual}` !== integrity)
    throw new Error("Downloaded asset failed its SHA-256 check.");
}
