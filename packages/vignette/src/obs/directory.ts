import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

/**
 * `vignette/obs` in the user's cache directory: `%LOCALAPPDATA%` on Windows, `~/Library/Caches`
 * on macOS, `$XDG_CACHE_HOME` or `~/.cache` elsewhere. Not the temp directory: OBS saves the
 * paths of the files kept here in its scene collection, and the OS empties temp directories.
 */
export function defaultObsDirectory(): string {
  return join(cacheRoot(), "vignette", "obs");
}

/** The per-user cache directory, by platform convention, honouring the variables that move it. */
function cacheRoot(): string {
  const { env, platform } = process;
  if (platform === "win32") return env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  if (platform === "darwin") return join(homedir(), "Library", "Caches");
  return env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
}
