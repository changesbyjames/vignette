import { use } from "react";
import { useSuspenseQuery, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";

import type { AssetEntry } from "../core/assets.js";
import { verifyAssetHash } from "../target/asset-store.js";
import { useStreamContext } from "./context.js";
import { useSetup } from "./hooks.js";

/** Asset query keys are `["vignette", "asset", hash]`: one download per content hash. */
const AssetQueryKeySchema = z.tuple([z.literal("vignette"), z.literal("asset"), z.string()]);
/** Asset query keys are `["vignette", "asset", hash]`: one download per content hash. */
type AssetQueryKey = z.output<typeof AssetQueryKeySchema>;

function assetQueryKey(hash: string): AssetQueryKey {
  return ["vignette", "asset", hash];
}

/** How long an asset no component uses stays downloaded, so remounts do not download again. */
const ASSET_GC_TIME_MS = 30 * 60 * 1000;

/** A failure that retrying cannot fix: wrong bytes, or an asset the stream does not list. */
class PermanentAssetError extends Error {
  override readonly name = "PermanentAssetError";
}

/**
 * The object URL of a downloaded, hash-verified asset from the stream's manifest. Suspends until
 * the download completes; a failed download or verification throws to the nearest error
 * boundary. Downloads are TanStack queries keyed by content hash, so they are shared across
 * stages and survive remounts.
 */
export function useAsset(name: string): string {
  const { client } = useStreamContext();
  // Before the stream's setup arrives there is no manifest to look the name up in: suspend.
  const setup = useSetup() ?? use(client.setup);
  const entry = setup.assets.entries.find((candidate) => candidate.name === name);
  const base = setup.serve.assets;
  const { data } = useSuspenseQuery({
    queryKey: assetQueryKey(entry?.hash ?? `missing:${name}`),
    queryFn: async ({ signal }) => downloadAsset(name, entry, base, signal),
    staleTime: Infinity,
    gcTime: ASSET_GC_TIME_MS,
    retry: (failures, error) => failures < 2 && !(error instanceof PermanentAssetError),
  });
  return data;
}

/**
 * Fetches `serve.assets` + name, verifies the bytes against the manifest hash and keeps them as
 * an object URL. A name the manifest lacks, a missing location and wrong bytes are permanent.
 */
async function downloadAsset(
  name: string,
  entry: AssetEntry | undefined,
  base: string | undefined,
  signal: AbortSignal,
): Promise<string> {
  if (entry === undefined) {
    throw new PermanentAssetError(`Asset "${name}" is not in the stream's asset manifest.`);
  }
  if (base === undefined) {
    throw new PermanentAssetError("The stream's setup publishes no serve.assets location.");
  }
  const response = await fetch(new URL(entry.name, base), { signal });
  if (!response.ok) {
    throw new Error(`Asset "${entry.name}" download failed with HTTP ${String(response.status)}.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  try {
    await verifyAssetHash(entry, bytes);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : `Asset "${entry.name}" is corrupt.`;
    throw new PermanentAssetError(message, { cause });
  }
  const type = response.headers.get("content-type") ?? "";
  return URL.createObjectURL(new Blob([bytes], { type }));
}

const ObjectUrlSchema = z.string().startsWith("blob:");
type ObjectUrl = z.output<typeof ObjectUrlSchema>;
const watched = new WeakSet<QueryClient>();

/** Revokes an asset's object URL when its query is garbage-collected or removed. */
export function revokeRemovedAssets(client: QueryClient): void {
  if (watched.has(client)) return;
  watched.add(client);
  client.getQueryCache().subscribe((event) => {
    const key: unknown = event.query.queryKey;
    if (event.type !== "removed" || !AssetQueryKeySchema.safeParse(key).success) return;
    const data: unknown = event.query.state.data;
    const url = ObjectUrlSchema.safeParse(data);
    if (url.success) revoke(url.data);
  });
}

function revoke(url: ObjectUrl): void {
  URL.revokeObjectURL(url);
}
