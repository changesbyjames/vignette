#!/usr/bin/env node

import process from "node:process";

import { HELP, parsePreviewOptions } from "./cli-options.js";
import { createPreviews } from "./preview.js";

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.length <= 2) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const options = parsePreviewOptions(process.argv.slice(2));
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

void main().catch((cause: unknown) => {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  process.stderr.write(`vignette: ${error.message}\n`);
  process.exitCode = 1;
});
