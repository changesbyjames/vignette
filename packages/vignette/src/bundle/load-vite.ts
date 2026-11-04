import type * as Vite from "vite";

/**
 * Imports Vite, an optional peer dependency: only `bundle`, the Vite plugin and the `dev`,
 * `build` and `preview` commands need it, so a host that only composes or drives OBS never
 * loads it.
 */
export async function loadVite(): Promise<typeof Vite> {
  try {
    return await import("vite");
  } catch (cause) {
    throw new Error(
      "vignette: this needs Vite, an optional peer dependency. Install it with `pnpm add -D vite`.",
      { cause },
    );
  }
}
