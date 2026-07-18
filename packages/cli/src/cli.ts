#!/usr/bin/env node

import process from "node:process";

import {
  HELP,
  OBS_HELP,
  parseObsOptions,
  parsePreviewOptions,
  PREVIEW_HELP,
} from "./cli-options.js";
import { runObs } from "./obs.js";
import { createPreviews } from "./preview.js";

async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length === 0 || arguments_[0] === "--help") {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (arguments_.includes("--help")) {
    process.stdout.write(`${arguments_[0] === "obs" ? OBS_HELP : PREVIEW_HELP}\n`);
    return;
  }
  switch (arguments_[0]) {
    case "preview":
      await preview(arguments_);
      return;
    case "obs":
      await obs(arguments_);
      return;
    default:
      throw new Error(`Unknown command '${arguments_[0] ?? ""}'.\n\n${HELP}`);
  }
}

async function preview(arguments_: readonly string[]): Promise<void> {
  const options = parsePreviewOptions(arguments_);
  const results = await createPreviews(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(results, undefined, 2)}\n`);
    return;
  }
  for (const result of results) {
    const placeholders =
      result.placeholderCount === 0 ? "" : ` (${String(result.placeholderCount)} placeholders)`;
    process.stdout.write(`Created ${result.path}${placeholders}\n`);
  }
}

async function obs(arguments_: readonly string[]): Promise<void> {
  const options = parseObsOptions(arguments_);
  const controller = new AbortController();
  const stop = (): void => {
    controller.abort();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.stdout.write(
    `Streaming ${options.url} to ${options.obsUrl} for project '${options.project}'.\n`,
  );
  try {
    await runObs(options, controller.signal, (error) => {
      process.stderr.write(`vignette obs: ${error.message}\n`);
    });
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

void main().catch((cause: unknown) => {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  process.stderr.write(`vignette: ${error.message}\n`);
  process.exitCode = 1;
});
