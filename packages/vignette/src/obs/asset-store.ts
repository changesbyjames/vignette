import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import type { AssetEntry } from "../core/assets.js";
import { createAssetStore, type AssetStore } from "../target/asset-store.js";

/**
 * Keeps each verified asset as a file named by its hash and extension, and resolves it to that
 * path, which OBS inputs load. Without `dir` the files live in a temporary directory removed on
 * dispose; a pinned `dir` keeps its files on dispose.
 */
export function fileAssetStore(dir?: string): AssetStore {
  let root: Promise<string> | undefined = undefined;
  let disposing = false;
  const directory = (): Promise<string> => {
    root ??=
      dir === undefined
        ? mkdtemp(join(tmpdir(), "vignette-assets-"))
        : mkdir(dir, { recursive: true }).then(() => dir);
    return root;
  };
  const store = createAssetStore<string>({
    async store(entry, bytes) {
      const path = join(await directory(), fileName(entry));
      await writeFile(path, bytes);
      return path;
    },
    async release(path) {
      if (disposing && dir !== undefined) return;
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
      if (dir === undefined && root !== undefined) {
        await rm(await root, { recursive: true, force: true });
      }
    },
  };
}

/** `<hex digest><extension>`: content-addressed, and still recognisable to OBS by extension. */
function fileName(entry: AssetEntry): string {
  const digest = Buffer.from(entry.hash.slice("sha256-".length), "base64").toString("hex");
  return `${digest}${extname(entry.name)}`;
}
