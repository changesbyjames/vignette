import type { AssetEntry } from "../core/assets.js";
import type { SetupMessage } from "../stream/messages.js";

/** Downloads one asset's bytes. Built from `serve.assets` by default; targets may override it. */
export type AssetFetcher = (entry: AssetEntry, signal: AbortSignal) => Promise<Uint8Array>;

/** Reports each asset of an `ensure` call as it finishes, for status progress. */
export type AssetProgressListener = (name: string, error?: Error) => void;

/**
 * Content-addressed cache of a show's assets, keyed by hash. The kernel drives one per target;
 * the DOM store keeps object URLs and the OBS store keeps files. Implementations verify each
 * download against its `sha256-` hash before storing it.
 */
export interface AssetStore<Resolved = string> {
  /**
   * Downloads, verifies and stores every entry not already stored under its hash. Resolves when
   * all are stored; rejects if any failed after reporting each through `progress`.
   */
  ensure(
    entries: readonly AssetEntry[],
    fetch: AssetFetcher,
    progress?: AssetProgressListener,
  ): Promise<void>;
  /** The stored location of an ensured asset. Throws for a name that was not ensured. */
  resolve(name: string): Resolved;
  /** Releases every stored asset whose hash is not among `keep`. */
  evict(keep: readonly AssetEntry[]): Promise<void>;
  /** Releases everything. */
  dispose(): Promise<void>;
}

/** Where a concrete store keeps verified bytes: object URLs, files, or anything else. */
export interface AssetLocations<Resolved> {
  /** Keeps verified bytes and returns where they are. */
  store(entry: AssetEntry, bytes: Uint8Array<ArrayBuffer>): Resolved | Promise<Resolved>;
  /** Releases a location returned by `store`. */
  release(location: Resolved): void | Promise<void>;
}

/**
 * Builds an {@link AssetStore} from a place to keep bytes (plan §6.4). The bookkeeping is shared:
 * each hash is fetched once, verified against its `sha256-` digest, and stored; a hash already
 * stored or in flight is not fetched again. Stores differ only in `store` and `release`.
 */
export function createAssetStore<Resolved>(
  locations: AssetLocations<Resolved>,
): AssetStore<Resolved> {
  const abort = new AbortController();
  /** Every hash stored or being stored, by hash. A failed download is removed so it can retry. */
  const downloads = new Map<string, Promise<Resolved>>();
  const stored = new Map<string, Resolved>();
  let names = new Map<string, string>();

  /** Fetch, verify, store; a store disposed meanwhile releases the location straight away. */
  async function download(entry: AssetEntry, fetch: AssetFetcher): Promise<Resolved> {
    const bytes = new Uint8Array(await fetch(entry, abort.signal));
    await verifyAssetHash(entry, bytes);
    const location = await locations.store(entry, bytes);
    if (abort.signal.aborted || downloads.get(entry.hash) === undefined) {
      await locations.release(location);
      throw new Error(`Asset "${entry.name}" was released while it downloaded.`);
    }
    stored.set(entry.hash, location);
    return location;
  }

  function start(entry: AssetEntry, fetch: AssetFetcher): Promise<Resolved> {
    const existing = downloads.get(entry.hash);
    if (existing !== undefined) return existing;
    const pending = download(entry, fetch);
    downloads.set(entry.hash, pending);
    pending.catch(() => {
      if (downloads.get(entry.hash) === pending) downloads.delete(entry.hash);
    });
    return pending;
  }

  async function release(hashes: readonly string[]): Promise<void> {
    const released = hashes.flatMap((hash) => {
      const location = stored.get(hash);
      stored.delete(hash);
      downloads.delete(hash);
      return location === undefined ? [] : [location];
    });
    await Promise.all(released.map(async (location) => locations.release(location)));
  }

  return {
    async ensure(entries, fetch, progress) {
      names = new Map([...names, ...entries.map((entry) => [entry.name, entry.hash] as const)]);
      const results = await Promise.allSettled(
        entries.map(async (entry) => {
          try {
            await start(entry, fetch);
            progress?.(entry.name);
          } catch (cause) {
            const error = asError(cause, `Asset "${entry.name}" failed to download.`);
            progress?.(entry.name, error);
            throw error;
          }
        }),
      );
      const failures = results.flatMap((result) =>
        result.status === "rejected" ? [asError(result.reason, "Asset failed.")] : [],
      );
      const [first] = failures;
      if (first === undefined) return;
      throw failures.length === 1
        ? first
        : new AggregateError(failures, `${String(failures.length)} assets failed.`);
    },
    resolve(name) {
      const hash = names.get(name);
      const location = hash === undefined ? undefined : stored.get(hash);
      if (location === undefined) throw new Error(`Asset "${name}" is not downloaded.`);
      return location;
    },
    async evict(keep) {
      const kept = new Set<string>(keep.map((entry) => entry.hash));
      names = new Map<string, string>(keep.map((entry) => [entry.name, entry.hash]));
      await release([...downloads.keys()].filter((hash) => !kept.has(hash)));
    },
    async dispose() {
      abort.abort();
      names = new Map();
      await release([...downloads.keys()]);
    },
  };
}

/** Checks bytes against a `sha256-<base64>` hash (the Subresource Integrity format). */
export async function verifyAssetHash(
  entry: AssetEntry,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  const actual = `sha256-${btoa(binary)}`;
  if (actual !== entry.hash) {
    throw new Error(
      `Asset "${entry.name}" failed verification: expected ${entry.hash}, downloaded ${actual}.`,
    );
  }
}

function asError(cause: unknown, message: string): Error {
  return cause instanceof Error ? cause : new Error(message, { cause });
}

/** The default fetcher: `serve.assets` + name, as bytes. */
export function serveFetcher(setup: SetupMessage): AssetFetcher {
  return async (entry: AssetEntry, signal) => {
    const base = setup.serve.assets;
    if (base === undefined)
      throw new Error(
        "MISSING_SERVE: the setup lists assets but publishes no serve.assets location to fetch them from.",
      );
    const response = await fetch(new URL(entry.name, base), { signal });
    if (!response.ok) {
      throw new Error(
        `Asset "${entry.name}" download failed with HTTP ${String(response.status)}.`,
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  };
}
