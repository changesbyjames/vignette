import type { PreviewOptions } from "./types.js";

export const HELP = `Usage:
  vignette preview --snapshot <url|file> [options]

Options:
  --scene <id|label>  Scene to capture (defaults to the first scene)
  --name <name>       Output filename label
  --out <path>        PNG path, or output directory with --all-scenes
  --all-scenes        Capture every scene
  --timeout <ms>      Fetch and browser timeout (default: 10000)
  --json              Print machine-readable result JSON
  --help              Show this help`;

export function parsePreviewOptions(arguments_: readonly string[]): PreviewOptions {
  const values = [...arguments_];
  if (values.shift() !== "preview") throw new Error(`Expected the 'preview' command.\n\n${HELP}`);
  let snapshot: string | undefined;
  let scene: string | undefined;
  let name: string | undefined;
  let out: string | undefined;
  let timeoutMs = 10_000;
  let allScenes = false;
  let json = false;

  while (values.length > 0) {
    const flag = values.shift();
    switch (flag) {
      case "--snapshot":
        snapshot = takeValue(flag, values);
        break;
      case "--scene":
        scene = takeValue(flag, values);
        break;
      case "--name":
        name = takeValue(flag, values);
        break;
      case "--out":
        out = takeValue(flag, values);
        break;
      case "--timeout": {
        const raw = takeValue(flag, values);
        timeoutMs = Number(raw);
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
          throw new Error(`--timeout must be a positive integer; received '${raw}'.`);
        }
        break;
      }
      case "--all-scenes":
        allScenes = true;
        break;
      case "--json":
        json = true;
        break;
      default:
        throw new Error(`Unknown option '${flag ?? ""}'.\n\n${HELP}`);
    }
  }
  if (snapshot === undefined) throw new Error(`--snapshot is required.\n\n${HELP}`);
  if (allScenes && scene !== undefined)
    throw new Error("--scene and --all-scenes cannot be combined.");
  return {
    snapshot,
    allScenes,
    timeoutMs,
    json,
    ...(scene === undefined ? {} : { scene }),
    ...(name === undefined ? {} : { name }),
    ...(out === undefined ? {} : { out }),
  };
}

function takeValue(flag: string, values: string[]): string {
  const value = values.shift();
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}
