import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { glob } from "tinyglobby";

import type { AssetManifest } from "../core/assets.js";
import { framesHtml } from "./frames-html.js";
import { loadVite } from "./load-vite.js";
import { createAssetManifest, scanAssetFiles, type ScannedAsset } from "./scan-assets.js";

/** Options for {@link bundle}. */
export interface BundleOptions {
  /** Directory to write `frames.html`, `frames.js`, `assets/` and `assets.json` into. */
  readonly out: string;
  /**
   * Modules compiled into `frames.js` whose exported `StreamTransport`s (or arrays of them) the
   * frame page can read its stream with, for `serve.stream` schemes beyond SSE and WebSocket.
   * Package specifiers and relative paths resolve from the show's directory.
   */
  readonly transports?: readonly string[];
}

/** What {@link bundle} wrote. */
export interface BundleResult {
  /** The manifest written to `assets.json`; pass it to `compose({ assets })`. */
  readonly manifest: AssetManifest;
  /** Frame modules compiled into `frames.js`, as POSIX paths relative to the show's directory. */
  readonly frames: readonly string[];
}

const ENTRY_ID = "\0vignette-frames-entry";

/**
 * Bundles a show's browser-side pieces into `out`: the files in `assets/` next to the show with
 * their manifest, and every `*.frame.tsx`/`*.frame.jsx` under the show's directory compiled into
 * `frames.js` behind the static `frames.html`. Nothing written depends on where it is served.
 */
export async function bundle(
  showPath: string,
  { out, transports = [] }: BundleOptions,
): Promise<BundleResult> {
  const root = dirname(resolve(showPath));
  const outDir = resolve(out);
  const manifest = await bundleAssets(join(root, "assets"), outDir);
  const frames = await discoverFrames(root, outDir);
  if (frames.length === 0) {
    await rm(join(outDir, "frames.js"), { force: true });
    await rm(join(outDir, "frames.html"), { force: true });
  } else {
    const modules = transports.map((specifier) =>
      specifier.startsWith(".") ? resolve(root, specifier) : specifier,
    );
    await buildFrames(root, generateFrameEntry(frames, modules), outDir);
    await writeFile(join(outDir, "frames.html"), framesHtml({ script: "./frames.js" }));
  }
  return { manifest, frames: frames.map((file) => relative(root, file).replaceAll("\\", "/")) };
}

/** Copies `dir` to `out/assets/` (replacing what was there) and writes `out/assets.json`. */
async function bundleAssets(dir: string, out: string): Promise<AssetManifest> {
  const assets: readonly ScannedAsset[] = (await isDirectory(dir)) ? await scanAssetFiles(dir) : [];
  const target = join(out, "assets");
  await rm(target, { recursive: true, force: true });
  for (const asset of assets) {
    const destination = join(target, asset.entry.name);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(asset.file, destination);
  }
  const manifest = createAssetManifest(assets.map((asset) => asset.entry));
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "assets.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** Absolute paths of every frame module under `root` (outside `out`), sorted. */
export async function discoverFrames(root: string, out: string): Promise<string[]> {
  const ignore = ["**/node_modules/**", "**/dist/**", "**/out/**"];
  const outFromRoot = relative(root, out).replaceAll("\\", "/");
  if (outFromRoot !== "" && !outFromRoot.startsWith("../")) ignore.push(`${outFromRoot}/**`);
  const files = await glob("**/*.frame.{tsx,jsx}", { cwd: root, absolute: true, ignore });
  return files.sort();
}

/**
 * The module `frames.js` is built from. `mountFrames` ignores exports that are not frames, so
 * every export of every frame module can be passed through; `streamTransports` picks the
 * transports out of each transport module.
 */
export function generateFrameEntry(
  frames: readonly string[],
  transports: readonly string[] = [],
): string {
  const imports = [
    ...frames.map((file, index) => `import * as f${String(index)} from ${JSON.stringify(file)};`),
    ...transports.map(
      (specifier, index) => `import * as t${String(index)} from ${JSON.stringify(specifier)};`,
    ),
  ];
  const spread = frames.map((_, index) => `...f${String(index)}`).join(", ");
  if (transports.length === 0) {
    return `${imports.join("\n")}
import { mountFrames } from "@strangecyan/vignette/frame/mount";
mountFrames({ ${spread} });
`;
  }
  const modules = transports.map((_, index) => `t${String(index)}`).join(", ");
  return `${imports.join("\n")}
import { mountFrames, streamTransports } from "@strangecyan/vignette/frame/mount";
mountFrames({ ${spread} }, { transports: streamTransports(${modules}) });
`;
}

/** Compiles the frames entry, with React DOM and everything it imports, into `out/frames.js`. */
async function buildFrames(root: string, entry: string, out: string): Promise<void> {
  const { build } = await loadVite();
  await build({
    root,
    configFile: false,
    envDir: false,
    publicDir: false,
    logLevel: "warn",
    mode: "production",
    // Production JSX whatever NODE_ENV says: Vite picks jsxDEV from the ambient NODE_ENV only.
    oxc: { jsx: { development: false } },
    define: { "process.env.NODE_ENV": '"production"' },
    resolve: { dedupe: ["react", "react-dom"] },
    plugins: [
      {
        name: "vignette:frames-entry",
        resolveId: (id) => (id === ENTRY_ID ? ENTRY_ID : undefined),
        load: (id) => (id === ENTRY_ID ? entry : undefined),
      },
    ],
    build: {
      outDir: out,
      emptyOutDir: false,
      copyPublicDir: false,
      modulePreload: false,
      // Files a frame imports (images, fonts) are inlined so `frames.js` stays one file.
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      rolldownOptions: {
        input: ENTRY_ID,
        output: { format: "es", entryFileNames: "frames.js", codeSplitting: false },
      },
    },
  });
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
