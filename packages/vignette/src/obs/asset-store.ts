import { mkdir, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

import type { AssetEntry } from "../core/assets.js";
import { createAssetStore, type AssetStore } from "../target/asset-store.js";

/**
 * Keeps each verified asset in `dir` as a file named by its hash and extension, and resolves it to
 * that path, which OBS inputs load. Evicted assets are deleted; dispose keeps the files, because
 * OBS reloads the inputs naming them whenever it starts.
 */
export function fileAssetStore(dir: string): AssetStore {
  let created: Promise<unknown> | undefined = undefined;
  let disposing = false;
  const store = createAssetStore<string>({
    async store(entry, bytes) {
      created ??= mkdir(dir, { recursive: true });
      await created;
      const path = join(dir, fileName(entry));
      await writeFile(path, bytes);
      return path;
    },
    async release(path) {
      if (disposing) return;
      await rm(path, { force: true });
    },
  });
  return {
    ensure: (entries, fetch, progress) => store.ensure(entries, fetch, progress),
    resolve: (name) => store.resolve(name),
    evict: (keep) => store.evict(keep),
    async dispose() {
      disposing = true;
      await store.dispose();
    },
  };
}

/** `<hex digest><extension>`: content-addressed, and still recognisable to OBS by extension. */
function fileName(entry: AssetEntry): string {
  const digest = Buffer.from(entry.hash.slice("sha256-".length), "base64").toString("hex");
  return `${digest}${extname(entry.name)}`;
}
