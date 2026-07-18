import type { PreviewOptions } from "./types.js";

export const HELP = `Usage:
  vignette preview --snapshot <url|file> [options]
  vignette obs --project <id> --obs-url <url> --url <runtime-url> [options]

Commands:
  preview  Capture compiled scenes as PNG files
  obs      Stream a Vignette runtime to OBS

Run vignette <command> --help for command options.`;

export const PREVIEW_HELP = `Usage:
  vignette preview --snapshot <url|file> [options]

Options:
  --scene <id|label>  Scene to capture (defaults to the first scene)
  --name <name>       Output filename label
  --out <path>        PNG path, or output directory with --all-scenes
  --all-scenes        Capture every scene
  --timeout <ms>      Fetch and browser timeout (default: 10000)
  --json              Print machine-readable result JSON
  --help              Show this help`;

export const OBS_HELP = `Usage:
  vignette obs --project <id> --obs-url <url> --url <runtime-url> [options]

Options:
  --project <id>       Managed Vignette project ID
  --obs-url <url>      OBS WebSocket URL, e.g. ws://localhost:4455
  --password <value>   OBS WebSocket password (optional)
  --url <runtime-url>  Vignette runtime SSE URL
  --help               Show this help`;

export interface ObsCommandOptions {
  readonly project: string;
  readonly obsUrl: string;
  readonly password?: string;
  readonly url: string;
}

export function parsePreviewOptions(arguments_: readonly string[]): PreviewOptions {
  const values = [...arguments_];
  if (values.shift() !== "preview")
    throw new Error(`Expected the 'preview' command.\n\n${PREVIEW_HELP}`);
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
        throw new Error(`Unknown option '${flag ?? ""}'.\n\n${PREVIEW_HELP}`);
    }
  }
  if (snapshot === undefined) throw new Error(`--snapshot is required.\n\n${PREVIEW_HELP}`);
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

export function parseObsOptions(arguments_: readonly string[]): ObsCommandOptions {
  const values = [...arguments_];
  if (values.shift() !== "obs") throw new Error(`Expected the 'obs' command.\n\n${OBS_HELP}`);
  let project: string | undefined;
  let obsUrl: string | undefined;
  let password: string | undefined;
  let url: string | undefined;

  while (values.length > 0) {
    const flag = values.shift();
    switch (flag) {
      case "--project":
        project = takeValue(flag, values);
        break;
      case "--obs-url":
        obsUrl = takeValue(flag, values);
        break;
      case "--password":
        password = takeValue(flag, values);
        break;
      case "--url":
        url = takeValue(flag, values);
        break;
      default:
        throw new Error(`Unknown option '${flag ?? ""}'.\n\n${OBS_HELP}`);
    }
  }

  if (project === undefined) throw new Error(`--project is required.\n\n${OBS_HELP}`);
  if (obsUrl === undefined) throw new Error(`--obs-url is required.\n\n${OBS_HELP}`);
  if (url === undefined) throw new Error(`--url is required.\n\n${OBS_HELP}`);
  return {
    project,
    obsUrl,
    url,
    ...(password === undefined ? {} : { password }),
  };
}

function takeValue(flag: string, values: string[]): string {
  const value = values.shift();
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}
