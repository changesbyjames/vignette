import type { AssetRef, AssetResolver, ResolvedAsset } from "@cbj/react-obs-core";

export class DomAssetRegistry {
  readonly #resolver: AssetResolver;
  readonly #targetId: string;
  readonly #cache = new Map<string, Promise<string>>();

  constructor(resolver: AssetResolver, targetId: string) {
    this.#resolver = resolver;
    this.#targetId = targetId;
  }

  resolve(asset: AssetRef): Promise<string> {
    const existing = this.#cache.get(asset.name);
    if (existing !== undefined) return existing;

    const resolution = this.#resolver
      .resolve(asset, { targetId: this.#targetId, targetKind: "dom" })
      .then(toDomUrl)
      .catch((error: unknown) => {
        this.#cache.delete(asset.name);
        throw error;
      });
    this.#cache.set(asset.name, resolution);
    return resolution;
  }

  clear(): void {
    this.#cache.clear();
  }
}

function toDomUrl(asset: ResolvedAsset): string {
  if (asset.kind === "url") return asset.url;
  throw new TypeError(`DOM asset resolver returned filesystem path '${asset.path}'.`);
}
