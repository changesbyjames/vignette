import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");
const output = mkdtempSync(join(tmpdir(), "vignette-npm-"));

try {
  execFileSync("pnpm", ["pack", "--pack-destination", output], {
    cwd: resolve(root, "packages/vignette"),
    stdio: "inherit",
  });
  const tarballs = readdirSync(output).filter((file) => file.endsWith(".tgz"));
  if (tarballs.length !== 1) {
    throw new Error(`packages/vignette produced ${String(tarballs.length)} npm tarballs`);
  }
  const publishArgs = ["publish", join(output, tarballs[0])];
  if (dryRun) publishArgs.push("--dry-run");
  execFileSync("npm", publishArgs, { stdio: "inherit" });
} finally {
  rmSync(output, { force: true, recursive: true });
}
