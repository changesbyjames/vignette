import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { glob } from "tinyglobby";

import type { AssetEntry, AssetManifest } from "../core/assets.js";

/** One asset file found on disk: its manifest entry and where it lives. */
export interface ScannedAsset {
  readonly entry: AssetEntry;
  readonly file: string;
}

/**
 * Builds the asset manifest for every file under `dir`. Names are POSIX paths relative to `dir`
 * (what `<Image src>` and `<Video src>` refer to); hashes are `sha256-<base64>` of the bytes.
 */
export async function scanAssets(dir: string): Promise<AssetManifest> {
  return createAssetManifest((await scanAssetFiles(dir)).map((asset) => asset.entry));
}

/** Every file under `dir` with its entry, sorted by name. */
export async function scanAssetFiles(dir: string): Promise<readonly ScannedAsset[]> {
  // tinyglobby returns POSIX separators on every platform.
  const names = (await glob("**/*", { cwd: dir, onlyFiles: true })).sort(compareNames);
  return Promise.all(
    names.map(async (name) => {
      const file = join(dir, name);
      const hash = sha256(await readFile(file));
      return { entry: { name, hash }, file };
    }),
  );
}

/** The manifest for `entries`, whose `version` is a hash of every sorted `name:hash` line. */
export function createAssetManifest(entries: readonly AssetEntry[]): AssetManifest {
  const sorted = [...entries].sort((left, right) => compareNames(left.name, right.name));
  const version = sha256(sorted.map((entry) => `${entry.name}:${entry.hash}`).join("\n"));
  return { version, entries: sorted };
}

function sha256(data: string | Uint8Array): `sha256-${string}` {
  return `sha256-${createHash("sha256").update(data).digest("base64")}`;
}

/** Code-unit order, so the manifest does not depend on the host's locale. */
function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
