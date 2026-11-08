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

/**
 * What `bundle` writes to `frames.json`: the frame bundle's build hash, `sha256-<base64>` of its
 * code, absent for a show without frames. Hosts pass `build` to `compose({ frameBuild })`, which
 * stamps it on every frame source; it is never part of the manifest or the setup.
 */
export const FramesJsonSchema = z
  .object({ build: z.templateLiteral(["sha256-", z.string()]).optional() })
  .readonly();
/** What `bundle` writes to `frames.json`: the frame bundle's build hash, if the show has frames. */
export type FramesJson = z.output<typeof FramesJsonSchema>;
