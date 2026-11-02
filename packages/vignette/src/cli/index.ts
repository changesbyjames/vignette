#!/usr/bin/env node
/**
 * The `vignette` executable. For `dev` and `obs`, SIGINT or SIGTERM aborts the command, which
 * disposes what it started; a second signal, or any signal during a one-shot command, exits at once.
 *
 * @module
 */
import { runCli } from "./cli.js";

const argv = process.argv.slice(2);
const graceful = argv[0] === "dev" || argv[0] === "obs";
const controller = new AbortController();
const stop = () => {
  if (!graceful || controller.signal.aborted) process.exit(130);
  controller.abort();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

try {
  await runCli(argv, controller.signal);
  process.exitCode = 0;
} catch (cause) {
  process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exitCode = 1;
} finally {
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
}
