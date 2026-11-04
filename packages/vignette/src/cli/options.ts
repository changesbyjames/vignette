export const HELP = `Usage: vignette <command> [options]

Commands:
  dev <show>          Compose a show and serve its preview, stream, frames and assets
  build <show>        Write a server entry plus everything \`bundle\` produces
  bundle <show>       Write frames.html, frames.js, assets/ and assets.json
  obs <stream-url>    Converge the local OBS to a stream
  preview <stream-url>
                      Render scenes of a running stream to PNG

Run vignette <command> --help for its options.`;

export const DEV_HELP = `Usage: vignette dev <show> [options]

Options:
  --port <port>        Port to listen on (default: 4173)
  --host <host>        Host to bind (default: localhost)
  --obs                Also drive the local OBS
  --obs-url <url>      obs-websocket URL with --obs (default: ws://127.0.0.1:4455)
  --password <value>   obs-websocket password with --obs
  --source <module>    Load OBS source plugins from a module with --obs (repeatable)
  --help               Show this help`;

export const BUILD_HELP = `Usage: vignette build <show> [options]

Options:
  --out <dir>   Output directory (default: dist)
  --help        Show this help`;

export const BUNDLE_HELP = `Usage: vignette bundle <show> --out <dir>

Options:
  --out <dir>   Output directory (required)
  --help        Show this help`;

export const OBS_HELP = `Usage: vignette obs <stream-url> [options]

Options:
  --obs-url <url>      obs-websocket URL (default: ws://127.0.0.1:4455)
  --password <value>   obs-websocket password
  --source <module>    Load OBS source plugins exported by a module, e.g.
                       @strangecyan/vignette-moq/obs (repeatable; resolved from the current directory)
  --dir <dir>          Keep the files OBS loads here, such as downloaded assets
                       (default: vignette/obs in the user's cache directory)
  --help               Show this help`;

export const PREVIEW_HELP = `Usage: vignette preview <stream-url> [options]

Options:
  --scene <id>       Scene to render (default: the active scene, then the first)
  --out <path>       PNG file, or the output directory with --all-scenes
                     (default: <show>-<scene>.png in the current directory)
  --all-scenes       Render every scene
  --timeout <ms>     Stream and browser timeout (default: 30000)
  --help             Show this help

Needs Playwright with Chromium: pnpm add -D playwright && pnpm exec playwright install chromium`;

/** OBS options of `vignette dev --obs`. */
export interface DevObsOptions {
  readonly url?: string;
  readonly password?: string;
  /** Plugin module specifiers passed with `--source`, in order. */
  readonly sources: readonly string[];
}

export interface DevCommand {
  readonly command: "dev";
  readonly show: string;
  readonly port?: number;
  readonly host?: string;
  /** Present with `--obs`. */
  readonly obs?: DevObsOptions;
}

export interface BuildCommand {
  readonly command: "build";
  readonly show: string;
  readonly out: string;
}

export interface BundleCommand {
  readonly command: "bundle";
  readonly show: string;
  readonly out: string;
}

export interface ObsCommand {
  readonly command: "obs";
  readonly stream: string;
  readonly obsUrl?: string;
  readonly password?: string;
  /** Plugin module specifiers passed with `--source`, in order. */
  readonly sources: readonly string[];
  readonly dir?: string;
}

export interface PreviewCommand {
  readonly command: "preview";
  readonly stream: string;
  readonly scene?: string;
  readonly out?: string;
  readonly allScenes: boolean;
  readonly timeoutMs: number;
}

/** `--help`, or no command: print `text` and exit successfully. */
export interface HelpCommand {
  readonly command: "help";
  readonly text: string;
}

/** One parsed command line. */
export type CliCommand =
  | DevCommand
  | BuildCommand
  | BundleCommand
  | ObsCommand
  | PreviewCommand
  | HelpCommand;

interface CommandSpec {
  readonly help: string;
  /** Name of the single positional argument, for error messages. */
  readonly positional: string;
  readonly valueFlags: ReadonlySet<string>;
  readonly repeatableFlags?: ReadonlySet<string>;
  readonly switches?: ReadonlySet<string>;
}

interface ParsedCommand {
  readonly positional: string;
  readonly values: ReadonlyMap<string, string>;
  readonly repeated: ReadonlyMap<string, readonly string[]>;
  readonly switches: ReadonlySet<string>;
}

const SPECS = {
  dev: {
    help: DEV_HELP,
    positional: "<show>",
    valueFlags: new Set(["--port", "--host", "--obs-url", "--password"]),
    repeatableFlags: new Set(["--source"]),
    switches: new Set(["--obs"]),
  },
  build: { help: BUILD_HELP, positional: "<show>", valueFlags: new Set(["--out"]) },
  bundle: { help: BUNDLE_HELP, positional: "<show>", valueFlags: new Set(["--out"]) },
  obs: {
    help: OBS_HELP,
    positional: "<stream-url>",
    valueFlags: new Set(["--obs-url", "--password", "--dir"]),
    repeatableFlags: new Set(["--source"]),
  },
  preview: {
    help: PREVIEW_HELP,
    positional: "<stream-url>",
    valueFlags: new Set(["--scene", "--out", "--timeout"]),
    switches: new Set(["--all-scenes"]),
  },
} as const satisfies Readonly<Record<string, CommandSpec>>;

type CommandName = keyof typeof SPECS;

type CommandBuilder = (parsed: ParsedCommand) => CliCommand;

/** Builds each command from its parsed arguments. */
const COMMANDS = {
  dev: devCommand,
  build: (parsed) => ({
    command: "build",
    show: parsed.positional,
    out: parsed.values.get("--out") ?? "dist",
  }),
  bundle: (parsed) => ({
    command: "bundle",
    show: parsed.positional,
    out: requiredFlag(parsed, "--out", BUNDLE_HELP),
  }),
  obs: obsCommand,
  preview: previewCommand,
} satisfies Record<CommandName, CommandBuilder>;

/**
 * Parses `argv` without the node and script paths, e.g. `["obs", "http://host/stream"]`. No
 * command or a leading `--help` is the overview; `--help` anywhere after a command is its help.
 */
export function parseCommandLine(argv: readonly string[]): CliCommand {
  const [name, ...rest] = argv;
  if (name === undefined || isHelp(name)) return { command: "help", text: HELP };
  if (!isCommandName(name)) throw new Error(`Unknown command '${name}'.\n\n${HELP}`);
  const spec: CommandSpec = SPECS[name];
  if (rest.some(isHelp)) return { command: "help", text: spec.help };
  return COMMANDS[name](parseCommand(rest, spec));
}

function isHelp(argument: string): boolean {
  return argument === "--help" || argument === "-h";
}

function isCommandName(name: string): name is CommandName {
  return Object.hasOwn(SPECS, name);
}

/** `--obs` enables OBS; its other flags without it are a mistake, not something to ignore. */
function devCommand(parsed: ParsedCommand): DevCommand {
  const sources = parsed.repeated.get("--source") ?? [];
  const url = parsed.values.get("--obs-url");
  const password = parsed.values.get("--password");
  const obs = parsed.switches.has("--obs");
  if (!obs && (url !== undefined || password !== undefined || sources.length > 0)) {
    throw new Error("--obs-url, --password and --source need --obs.");
  }
  const rawPort = parsed.values.get("--port");
  return {
    command: "dev",
    show: parsed.positional,
    port: rawPort === undefined ? undefined : parsePort(rawPort),
    host: parsed.values.get("--host"),
    obs: obs ? { url, password, sources } : undefined,
  };
}

function obsCommand(parsed: ParsedCommand): ObsCommand {
  return {
    command: "obs",
    stream: httpUrl(parsed.positional, "<stream-url>"),
    obsUrl: parsed.values.get("--obs-url"),
    password: parsed.values.get("--password"),
    sources: parsed.repeated.get("--source") ?? [],
    dir: parsed.values.get("--dir"),
  };
}

/** One scene or all of them, never both; the timeout must be a positive whole number of ms. */
function previewCommand(parsed: ParsedCommand): PreviewCommand {
  const scene = parsed.values.get("--scene");
  const allScenes = parsed.switches.has("--all-scenes");
  if (allScenes && scene !== undefined) {
    throw new Error("--scene and --all-scenes cannot be combined.");
  }
  const rawTimeout = parsed.values.get("--timeout");
  const timeoutMs = rawTimeout === undefined ? 30_000 : Number(rawTimeout);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`--timeout must be a positive integer; received '${rawTimeout ?? ""}'.`);
  }
  return {
    command: "preview",
    stream: httpUrl(parsed.positional, "<stream-url>"),
    scene,
    out: parsed.values.get("--out"),
    allScenes,
    timeoutMs,
  };
}

/** A TCP port; 0 asks the system for a free one. */
function parsePort(raw: string): number {
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`--port must be an integer from 0 to 65535; received '${raw}'.`);
  }
  return port;
}

/** Only absolute `http:` and `https:` URLs; a relative path has no origin to connect to. */
function httpUrl(value: string, name: string): string {
  const url = URL.parse(value);
  if (url?.protocol === "http:" || url?.protocol === "https:") return value;
  throw new Error(`${name} must be an absolute HTTP(S) URL; received '${value}'.`);
}

/**
 * Consumes each value immediately so a missing argument cannot be mistaken for the next flag.
 * Value flags keep their last occurrence; repeatable flags accumulate in command-line order.
 * Exactly one argument that is not a flag is the command's positional argument.
 */
function parseCommand(arguments_: readonly string[], spec: CommandSpec): ParsedCommand {
  const remaining = [...arguments_];
  const positionals: string[] = [];
  const values = new Map<string, string>();
  const repeated = new Map<string, string[]>();
  const switches = new Set<string>();
  while (remaining.length > 0) {
    // A known flag takes its value now; anything else is the positional or an unknown option.
    const argument = remaining.shift() ?? "";
    if (spec.valueFlags.has(argument)) values.set(argument, takeValue(argument, remaining));
    else if (spec.repeatableFlags?.has(argument) === true) {
      repeated.set(argument, [...(repeated.get(argument) ?? []), takeValue(argument, remaining)]);
    } else if (spec.switches?.has(argument) === true) switches.add(argument);
    else positionals.push(positionalArgument(argument, spec));
  }
  return { positional: onePositional(positionals, spec), values, repeated, switches };
}

function positionalArgument(argument: string, spec: CommandSpec): string {
  if (argument.startsWith("-")) throw new Error(`Unknown option '${argument}'.\n\n${spec.help}`);
  return argument;
}

function onePositional(positionals: readonly string[], spec: CommandSpec): string {
  const [positional, ...extra] = positionals;
  if (positional === undefined) throw new Error(`${spec.positional} is required.\n\n${spec.help}`);
  if (extra.length > 0) {
    throw new Error(`Unexpected argument '${extra.join(" ")}'.\n\n${spec.help}`);
  }
  return positional;
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
