import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootPackage = readJson("package.json");
const packages = [
  packageConfig("packages/core", "@cbj/vignette-core", [".", "./builders"]),
  packageConfig(
    "packages/target-dom",
    "@cbj/vignette-target-dom",
    [".", "./react"],
    ["@cbj/vignette-core"],
  ),
  packageConfig("packages/target-obs", "@cbj/vignette-target-obs", ["."], ["@cbj/vignette-core"]),
  packageConfig("packages/react", "@cbj/vignette", ["."], ["@cbj/vignette-core"]),
  packageConfig(
    "packages/frame",
    "@cbj/vignette-frame",
    [".", "./client", "./server", "./vite"],
    ["@cbj/vignette-core", "@cbj/vignette"],
  ),
  packageConfig(
    "packages/server",
    "@cbj/vignette-server",
    ["."],
    ["@cbj/vignette-core", "@cbj/vignette-frame", "@cbj/vignette"],
  ),
  packageConfig(
    "packages/moq",
    "@cbj/vignette-moq",
    [".", "./react", "./dom", "./obs"],
    ["@cbj/vignette-core", "@cbj/vignette", "@cbj/vignette-target-dom", "@cbj/vignette-target-obs"],
    true,
  ),
  packageConfig(
    "packages/testkit",
    "@cbj/vignette-testkit",
    ["."],
    ["@cbj/vignette-core", "@cbj/vignette-target-obs"],
  ),
];

for (const candidate of packages) {
  const manifest = readJson(`${candidate.directory}/package.json`);
  const jsr = readJson(`${candidate.directory}/deno.json`);

  assert(manifest.private === true, `${candidate.name} must be protected from npm publishing`);
  assert(manifest.name === candidate.name, `${candidate.directory} has an unexpected package name`);
  assert(jsr.name === candidate.name, `${candidate.directory}/deno.json has an unexpected name`);
  assert(jsr.version === rootPackage.version, `${candidate.name} has a mismatched JSR version`);
  assert(manifest.version === jsr.version, `${candidate.name} has mismatched manifest versions`);
  assert(jsr.license === "MIT", `${candidate.name} must declare its MIT license`);
  assertExports(jsr.exports, candidate.exports, candidate.name);

  for (const dependency of candidate.dependencies) {
    assert(
      manifest.dependencies?.[dependency] === "workspace:^",
      `${candidate.name} must depend on ${dependency} through workspace:^`,
    );
  }

  for (const path of ["README.md", "deno.json", "package.json"]) {
    assert(
      existsSync(resolve(root, candidate.directory, path)),
      `${candidate.name} is missing ${path}`,
    );
  }

  if (!process.argv.includes("--skip-dry-run")) {
    const args = ["exec", "jsr", "publish", "--dry-run", "--allow-dirty"];
    if (candidate.allowSlowTypes) args.push("--allow-slow-types");
    execFileSync("pnpm", args, { cwd: resolve(root, candidate.directory), stdio: "inherit" });
    console.log(`✓ ${candidate.name}@${jsr.version} passes JSR publish verification`);
  }
}

const releaseTag =
  process.argv.find((argument) => /^v\d/u.test(argument)) ?? process.env.RELEASE_TAG;
if (releaseTag) {
  assert(
    releaseTag === `v${rootPackage.version}`,
    `release tag ${releaseTag} does not match v${rootPackage.version}`,
  );
}

function packageConfig(directory, name, exports, dependencies = [], allowSlowTypes = false) {
  return { directory, name, exports, dependencies, allowSlowTypes };
}

function assertExports(actual, expected, name) {
  const names = typeof actual === "string" ? ["."] : Object.keys(actual);
  assert(
    names.length === expected.length && expected.every((entry) => names.includes(entry)),
    `${name} has unexpected JSR exports`,
  );
  const paths = typeof actual === "string" ? [actual] : Object.values(actual);
  assert(
    paths.every((path) => path.startsWith("./src/")),
    `${name} must publish TypeScript source`,
  );
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
