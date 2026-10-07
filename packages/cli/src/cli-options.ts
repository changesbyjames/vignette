import { isAbsoluteHttpUrl, omitUndefined } from "@strangecyan/vignette-core";
import type { PreviewOptions } from "./types.js";

export const HELP = `Usage:
  vignette preview --snapshot <url|file> [options]
  vignette obs --project <id> --obs-url <url> --url <stream-url> [options]

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
  --base-url <url>    Base for root-relative snapshot URLs (defaults to the snapshot URL;
                      required for files whose snapshot contains root-relative URLs)
  --timeout <ms>      Fetch and browser timeout (default: 10000)
  --json              Print machine-readable result JSON
  --help              Show this help`;

export const OBS_HELP = `Usage:
  vignette obs --project <id> --obs-url <url> --url <stream-url> [options]

Options:
  --project <id>       Managed Vignette project ID; must match the composition's
                       id, or the runtime refuses to manage OBS
  --obs-url <url>      OBS WebSocket URL, e.g. ws://localhost:4455
  --password <value>   OBS WebSocket password (optional)
  --url <stream-url>   Vignette composer stream (SSE) URL; also the base for root-relative
                       asset and browser-source URLs
  --browser-source-base-url <url>
                       Base OBS uses for root-relative browser-source URLs when OBS
                       reaches the composer at a different host than this process
  --extension <module> Load OBS source codecs exported by a module, e.g.
                       @strangecyan/vignette-moq/obs (repeatable; resolved from
                       the current directory)
  --help               Show this help`;

export interface ObsCommandOptions {
  readonly project: string;
  readonly obsUrl: string;
  readonly password?: string;
  readonly url: string;
  readonly browserSourceBaseUrl?: string;
  /** Module specifiers passed with `--extension`, in order. */
  readonly extensions: readonly string[];
}

interface CommandSpec {
  readonly command: string;
  readonly help: string;
  readonly valueFlags: ReadonlySet<string>;
  readonly repeatableFlags?: ReadonlySet<string>;
  readonly switches: ReadonlySet<string>;
}

interface ParsedCommand {
  readonly values: ReadonlyMap<string, string>;
  readonly repeated: ReadonlyMap<string, readonly string[]>;
  readonly switches: ReadonlySet<string>;
}

/** Require input and timeout options, then reject conflicting single-scene and all-scenes selection. */
export function parsePreviewOptions(arguments_: readonly string[]): PreviewOptions {
  const parsed = parseCommand(arguments_, {
    command: "preview",
    help: PREVIEW_HELP,
    valueFlags: new Set(["--snapshot", "--scene", "--name", "--out", "--timeout", "--base-url"]),
    switches: new Set(["--all-scenes", "--json"]),
  });
  const snapshot = requiredFlag(parsed, "--snapshot", PREVIEW_HELP);
  const scene = parsed.values.get("--scene");
  const allScenes = parsed.switches.has("--all-scenes");
  if (allScenes && scene !== undefined)
    throw new Error("--scene and --all-scenes cannot be combined.");
  const rawTimeout = parsed.values.get("--timeout");
  const timeoutMs = rawTimeout === undefined ? 10_000 : Number(rawTimeout);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new Error(`--timeout must be a positive integer; received '${rawTimeout ?? ""}'.`);
  return omitUndefined({
    snapshot,
    scene,
    allScenes,
    timeoutMs,
    json: parsed.switches.has("--json"),
    name: parsed.values.get("--name"),
    out: parsed.values.get("--out"),
    baseUrl: optionalHttpUrl(parsed, "--base-url"),
  });
}

export function parseObsOptions(arguments_: readonly string[]): ObsCommandOptions {
  const parsed = parseCommand(arguments_, {
    command: "obs",
    help: OBS_HELP,
    valueFlags: new Set([
      "--project",
      "--obs-url",
      "--password",
      "--url",
      "--browser-source-base-url",
    ]),
    repeatableFlags: new Set(["--extension"]),
    switches: new Set<string>(),
  });
  return omitUndefined({
    project: requiredFlag(parsed, "--project", OBS_HELP),
    obsUrl: requiredFlag(parsed, "--obs-url", OBS_HELP),
    url: requiredHttpUrl(parsed, "--url", OBS_HELP),
    password: parsed.values.get("--password"),
    browserSourceBaseUrl: optionalHttpUrl(parsed, "--browser-source-base-url"),
    extensions: parsed.repeated.get("--extension") ?? [],
  });
}

function requiredHttpUrl(parsed: ParsedCommand, flag: string, help: string): string {
  requiredFlag(parsed, flag, help);
  return optionalHttpUrl(parsed, flag) ?? requiredFlag(parsed, flag, help);
}

function optionalHttpUrl(parsed: ParsedCommand, flag: string): string | undefined {
  const value = parsed.values.get(flag);
  if (value === undefined || isAbsoluteHttpUrl(value)) return value;
  throw new Error(`${flag} must be an absolute HTTP(S) URL; received '${value}'.`);
}

/** Consume each value immediately so a missing argument cannot be mistaken for the next flag. */
function parseCommand(arguments_: readonly string[], spec: CommandSpec): ParsedCommand {
  const remaining = [...arguments_];
  if (remaining.shift() !== spec.command)
    throw new Error(`Expected the '${spec.command}' command.\n\n${spec.help}`);
  const values = new Map<string, string>();
  const repeated = new Map<string, string[]>();
  const switches = new Set<string>();
  while (remaining.length > 0) {
    // Value flags keep their last occurrence; repeatable flags accumulate in command-line order.
    const flag = remaining.shift() ?? "";
    if (spec.valueFlags.has(flag)) values.set(flag, takeValue(flag, remaining));
    else if (spec.repeatableFlags?.has(flag) === true) {
      repeated.set(flag, [...(repeated.get(flag) ?? []), takeValue(flag, remaining)]);
    } else if (spec.switches.has(flag)) switches.add(flag);
    else throw new Error(`Unknown option '${flag}'.\n\n${spec.help}`);
  }
  return { values, repeated, switches };
}

function requiredFlag(parsed: ParsedCommand, flag: string, help: string): string {
  const value = parsed.values.get(flag);
  if (value === undefined) throw new Error(`${flag} is required.\n\n${help}`);
  return value;
}

function takeValue(flag: string, values: string[]): string {
  const value = values.shift();
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}
