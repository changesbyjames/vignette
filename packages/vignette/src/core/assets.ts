import { z } from "zod";

/** One asset a show references: its name (as written in `src`) and its content hash. */
export const AssetEntrySchema = z
  .object({ name: z.string().min(1), hash: z.templateLiteral(["sha256-", z.string()]) })
  .readonly();
/** One asset a show references: its name (as written in `src`) and its content hash. */
export type AssetEntry = z.output<typeof AssetEntrySchema>;

/**
 * Names and content hashes of every asset a show may reference, produced by `bundle` or
 * `scanAssets`. It never contains a location; hosts publish `serve.assets` separately.
 */
export const AssetManifestSchema = z
  .object({ version: z.string(), entries: z.array(AssetEntrySchema).readonly() })
  .readonly();
/** Names and content hashes of every asset a show may reference. */
export type AssetManifest = z.output<typeof AssetManifestSchema>;
