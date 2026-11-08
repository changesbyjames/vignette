import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { glob } from "tinyglobby";

import type { AssetManifest, FramesJson } from "../core/assets.js";
import { framesHtml } from "./frames-html.js";
import { loadVite } from "./load-vite.js";
import { createAssetManifest, scanAssetFiles, type ScannedAsset } from "./scan-assets.js";

/** Options for {@link bundle}. */
export interface BundleOptions {
  /**
   * Directory to write `frames.html`, `frames.<hash>.js`, `frames.json`, `assets/` and
   * `assets.json` into.
   */
  readonly out: string;
  /**
   * Modules compiled into the frame bundle whose exported `StreamTransport`s (or arrays of them) the
   * frame page can read its stream with, for `serve.stream` schemes beyond SSE and WebSocket.
   * Package specifiers and relative paths resolve from the show's directory.
   */
  readonly transports?: readonly string[];
}

/** What {@link bundle} wrote. */
export interface BundleResult {
  /** The manifest written to `assets.json`; pass it to `compose({ assets })`. */
  readonly manifest: AssetManifest;
  /** Frame modules compiled into the frame bundle, as POSIX paths relative to the show's directory. */
  readonly frames: readonly string[];
  /**
   * The frame bundle's build hash, `sha256-<base64>` of its code, written to `frames.json` as
   * `build`; pass it to `compose({ frameBuild })`. Absent when the show has no frames.
   */
  readonly build?: StampedBuild["build"];
  /** The frame bundle's file name, `frames.<hash>.js`, which `frames.html` loads. */
  readonly script?: string;
}

/** The bundle's build hash and the file it was written to. */
interface StampedBuild {
  readonly build: `sha256-${string}`;
  readonly script: string;
}

const ENTRY_ID = "\0vignette-frames-entry";
/** Stands in for the build hash in the built code, which is hashed with it and then replaced. */
const BUILD_PLACEHOLDER = "__vignette_frames_build_placeholder__";
/** What Vite writes before the bundle is renamed to its hashed name. */
const UNHASHED_SCRIPT = "frames.js";
const HASHED_SCRIPT = /^frames\.[0-9a-f]+\.js$/u;

/**
 * Bundles a show's browser-side pieces into `out`: the files in `assets/` next to the show with
 * their manifest, and every `*.frame.tsx`/`*.frame.jsx` under the show's directory compiled into
 * `frames.<hash>.js` behind the static `frames.html`, with the bundle's build hash in
 * `frames.json`. Nothing written depends on where it is served. The same sources build the same
 * hash; serve `frames.html` uncached and the hashed bundle as immutable.
 */
export async function bundle(
  showPath: string,
  { out, transports = [] }: BundleOptions,
): Promise<BundleResult> {
  const root = dirname(resolve(showPath));
  const outDir = resolve(out);
  const manifest = await bundleAssets(join(root, "assets"), outDir);
  const frames = await discoverFrames(root, outDir);
  const relativeFrames = frames.map((file) => relative(root, file).replaceAll("\\", "/"));
  if (frames.length === 0) {
    await removeScripts(outDir);
    await rm(join(outDir, "frames.html"), { force: true });
    await writeFramesJson(outDir, {});
    return { manifest, frames: relativeFrames };
  }
  const modules = transports.map((specifier) =>
    specifier.startsWith(".") ? resolve(root, specifier) : specifier,
  );
  await buildFrames(
    root,
    generateFrameEntry(frames, {
      build: BUILD_PLACEHOLDER,
      transports: modules,
    }),
    outDir,
  );
  const { build, script } = await stampBuild(outDir);
  await writeFile(join(outDir, "frames.html"), framesHtml({ script: `./${script}` }));
  await writeFramesJson(outDir, { build });
  // Only once the new page is written, so a failed build leaves the last one working.
  await removeScripts(outDir, script);
  return { manifest, frames: relativeFrames, build, script };
}

/**
 * Hashes the built bundle, writes it as `frames.<hash>.js` with its build hash in place of the
 * placeholder, and removes the unhashed file. The hash covers the code with the placeholder, so it
 * depends only on what was built.
 */
async function stampBuild(out: string): Promise<StampedBuild> {
  const built = join(out, UNHASHED_SCRIPT);
  const code = await readFile(built, "utf8");
  const parts = code.split(BUILD_PLACEHOLDER);
  if (parts.length !== 2) {
    throw new Error(
      `bundle: expected the build placeholder once in the frame bundle, found it ${String(parts.length - 1)} times.`,
    );
  }
  const digest = createHash("sha256").update(code).digest();
  const build: StampedBuild["build"] = `sha256-${digest.toString("base64")}`;
  const script = `frames.${digest.toString("hex").slice(0, 16)}.js`;
  await writeFile(join(out, script), parts.join(build));
  await rm(built);
  return { build, script };
}

/** Removes frame bundles a previous `bundle` wrote, hashed or not, except `keep`. */
async function removeScripts(out: string, keep?: string): Promise<void> {
  const files = await glob("frames*.js", { cwd: out, onlyFiles: true });
  const stale = files.filter(
    (file) => file !== keep && (file === UNHASHED_SCRIPT || HASHED_SCRIPT.test(file)),
  );
  await Promise.all(stale.map((file) => rm(join(out, file), { force: true })));
}

async function writeFramesJson(out: string, contents: FramesJson): Promise<void> {
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "frames.json"), `${JSON.stringify(contents, null, 2)}\n`);
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
  const files = await glob("**/*.frame.{tsx,jsx}", {
    cwd: root,
    absolute: true,
    ignore,
  });
  return files.sort();
}

/** Options of {@link generateFrameEntry}. */
export interface FrameEntryOptions {
  /** The build hash `mountFrames` checks its source's `build` against; none in dev. */
  readonly build?: string;
  /** Transport module specifiers whose exported stream transports the frame page can use. */
  readonly transports?: readonly string[];
}

/**
 * The module the frame bundle is built from. `mountFrames` ignores exports that are not frames,
 * so every export of every frame module can be passed through; `streamTransports` picks the
 * transports out of each transport module.
 */
export function generateFrameEntry(
  frames: readonly string[],
  { build, transports = [] }: FrameEntryOptions = {},
): string {
  const imports = [
    ...frames.map((file, index) => `import * as f${String(index)} from ${JSON.stringify(file)};`),
    ...transports.map(
      (specifier, index) => `import * as t${String(index)} from ${JSON.stringify(specifier)};`,
    ),
  ];
  const spread = frames.map((_, index) => `...f${String(index)}`).join(", ");
  const fields = [
    ...(build === undefined ? [] : [`build: ${JSON.stringify(build)}`]),
    ...(transports.length === 0
      ? []
      : [
          `transports: streamTransports(${transports.map((_, index) => `t${String(index)}`).join(", ")})`,
        ]),
  ];
  const options = fields.length === 0 ? "" : `, { ${fields.join(", ")} }`;
  const named = transports.length === 0 ? "mountFrames" : "mountFrames, streamTransports";
  return `${imports.join("\n")}
import { ${named} } from "@strangecyan/vignette/frame/mount";
mountFrames({ ${spread} }${options});
`;
}

/**
 * Compiles the frames entry, with React DOM and everything it imports, into `out/frames.js`, which
 * {@link stampBuild} then renames to its hashed name.
 */
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
      // Files a frame imports (images, fonts) are inlined so the bundle stays one file.
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      rolldownOptions: {
        input: ENTRY_ID,
        output: {
          format: "es",
          entryFileNames: UNHASHED_SCRIPT,
          codeSplitting: false,
        },
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
