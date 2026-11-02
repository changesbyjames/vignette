import { createAssetStore, type AssetStore } from "../target/asset-store.js";

/** Keeps each verified asset as a Blob and resolves it to an object URL; revokes on release. */
export function objectUrlAssetStore(): AssetStore {
  return createAssetStore({
    store: (_entry, bytes) => URL.createObjectURL(new Blob([bytes])),
    release: (url) => {
      URL.revokeObjectURL(url);
    },
  });
}
