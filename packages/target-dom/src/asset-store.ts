import {
  resolveResourceUrl,
  validateAssetName,
  validateResourceUrl,
  type AssetManifest,
  type AssetRef,
  type AssetResolver,
  type ResolvedAsset,
} from "@strangecyan/vignette-core";

export interface DomAssetStoreOptions {
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly createObjectURL?: ((blob: Blob) => string) | undefined;
  readonly revokeObjectURL?: ((url: string) => void) | undefined;
}

export class DomAssetStore implements AssetResolver {
  private readonly baseUrl: string;
  private readonly fetch: typeof globalThis.fetch;
  private readonly createObjectURL: (blob: Blob) => string;
  private readonly revokeObjectURL: (url: string) => void;
  private urls = new Map<string, string>();

  /**
   * Use injected I/O or bind the platform fetch and object-URL implementations. `baseUrl` is the
   * absolute base for root-relative manifest URLs.
   */
  constructor(baseUrl: string, options: DomAssetStoreOptions = {}) {
    this.baseUrl = baseUrl;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.createObjectURL = options.createObjectURL ?? URL.createObjectURL.bind(URL);
    this.revokeObjectURL = options.revokeObjectURL ?? URL.revokeObjectURL.bind(URL);
  }

  /** Download and verify the new manifest before replacing existing URLs, releasing partial allocations on failure. */
  async setup(manifest: AssetManifest): Promise<void> {
    validateManifest(manifest);
    const next = new Map<string, string>();
    try {
      const downloads = await Promise.all(
        manifest.assets.map(async (entry) => {
          const response = await this.fetch(resolveResourceUrl(entry.url, this.baseUrl));
          if (!response.ok) {
            throw new Error(
              `Asset '${entry.name}' download failed with HTTP ${String(response.status)}.`,
            );
          }
          const blob = await response.blob();
          if (entry.integrity !== undefined) await verifyBlobIntegrity(blob, entry.integrity);
          return { name: entry.name, blob };
        }),
      );
      for (const download of downloads) {
        next.set(download.name, this.createObjectURL(download.blob));
      }
    } catch (error) {
      for (const url of next.values()) this.revokeObjectURL(url);
      throw error;
    }

    const previous = this.urls;
    this.urls = next;
    for (const url of previous.values()) this.revokeObjectURL(url);
  }

  resolve(asset: AssetRef): Promise<ResolvedAsset> {
    const url = this.urls.get(asset.name);
    return url === undefined
      ? Promise.reject(new Error(`Asset '${asset.name}' is absent from the runtime manifest.`))
      : Promise.resolve({ kind: "url", url });
  }

  dispose(): void {
    for (const url of this.urls.values()) this.revokeObjectURL(url);
    this.urls.clear();
  }
}

/** Reject invalid or repeated asset names and require HTTP(S) or root-relative URLs before starting downloads. */
function validateManifest(manifest: AssetManifest): void {
  const names = new Set<string>();
  for (const entry of manifest.assets) {
    // Reject invalid or repeated asset names and require HTTP(S) or root-relative URLs before starting downloads.

    const error = validateAssetName(entry.name);
    if (error !== undefined) throw new Error(error);
    if (names.has(entry.name)) {
      throw new Error(`Asset manifest contains duplicate name '${entry.name}'.`);
    }
    names.add(entry.name);
    const urlError = validateResourceUrl(entry.url);
    if (urlError !== undefined) throw new Error(`Asset '${entry.name}' ${urlError}`);
  }
}

async function verifyBlobIntegrity(blob: Blob, integrity: `sha256-${string}`): Promise<void> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  const actual = bytesToBase64(new Uint8Array(digest));
  if (`sha256-${actual}` !== integrity)
    throw new Error("Downloaded asset failed its SHA-256 check.");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
