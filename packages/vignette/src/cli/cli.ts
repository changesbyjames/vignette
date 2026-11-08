import { runBuild } from "./build.js";
import { runBundle } from "./bundle.js";
import { runDev } from "./dev.js";
import { runObs } from "./obs.js";
import { parseCommandLine, type DevCommand } from "./options.js";
import { runPreview } from "./preview.js";

/**
 * Runs one `vignette` command line (without the node and script paths). Long-running commands
 * (`dev`, `obs`) run until `signal` aborts and then dispose what they started.
 */
export async function runCli(argv: readonly string[], signal: AbortSignal): Promise<void> {
  const command = parseCommandLine(argv);
  switch (command.command) {
    case "help":
      process.stdout.write(`${command.text}\n`);
      return;
    case "dev":
      await dev(command, signal);
      return;
    case "build":
      await runBuild({ show: command.show, out: command.out });
      process.stdout.write(`built ${command.out}\n`);
      return;
    case "bundle":
      await runBundle(command.show, command.out, command.transports);
      return;
    case "obs":
      await runObs({ ...command, signal });
      return;
    case "preview":
      await runPreview(command);
      return;
  }
}

async function dev(command: DevCommand, signal: AbortSignal): Promise<void> {
  const server = await runDev({
    show: command.show,
    port: command.port,
    host: command.host,
    obs:
      command.obs === undefined ? undefined : { ...command.obs, sources: [...command.obs.sources] },
  });
  process.stdout.write(`vignette dev: ${server.origin}/  stream: ${server.origin}/stream\n`);
  await new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    signal.addEventListener("abort", () => {
      resolve();
    });
  });
  await server.close();
}
