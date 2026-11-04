import { z } from "zod";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = "packages/vignette";
const name = "vignette";
const repository = "git+https://github.com/changesbyjames/vignette.git";
const expectedExports = [
  ".",
  "./react",
  "./dom",
  "./obs",
  "./obs/testing",
  "./frame",
  "./frame/mount",
  "./bundle",
  "./vite",
  "./yoga.wasm",
];
// Heavy tools only some commands need: optional peers, imported lazily, never dependencies.
const optionalPeers = ["vite", "playwright"];
// Exports that publish binary assets rather than built JavaScript.
const nonJavaScriptExports = new Set(["./yoga.wasm"]);

const rootPackage = readJson("package.json");
const manifest = readJson(`${directory}/package.json`);

assert(manifest.private === undefined, `${name} must be publishable`);
assert(manifest.name === name, `${directory} has an unexpected package name`);
assert(manifest.version === rootPackage.version, `${name} has a mismatched version`);
assert(manifest.license === "MIT", `${name} must declare its MIT license`);
assert(manifest.publishConfig?.access === "public", `${name} must publish publicly`);
assert(manifest.repository?.url === repository, `${name} has an unexpected repository`);
assert(manifest.repository?.directory === directory, `${name} has an unexpected directory`);
assertSet(manifest.files, ["bin", "dist", "vendor"], `${name} has unexpected published files`);
assertExports(manifest.exports);
for (const peer of optionalPeers) {
  // Not a dependency, but a declared peer that is optional.
  assert(manifest.dependencies?.[peer] === undefined, `${name} must not depend on ${peer}`);
  assert(manifest.peerDependencies?.[peer] !== undefined, `${name} must declare ${peer} as a peer`);
  assert(
    manifest.peerDependenciesMeta?.[peer]?.optional === true,
    `${name} must mark ${peer} as an optional peer`,
  );
}
assert(existsSync(resolve(root, directory, "package.json")), `${name} is missing package.json`);

if (!process.argv.includes("--skip-dry-run")) {
  execFileSync("pnpm", ["publish", "--dry-run", "--no-git-checks"], {
    cwd: resolve(root, directory),
    stdio: "inherit",
    // Windows runs `pnpm.cmd`, which only a shell can start.
    shell: process.platform === "win32",
  });
  // The dry run builds the package (prepack), so every exported file must now exist.
  for (const [subpath, conditions] of Object.entries(manifest.exports)) {
    for (const file of [conditions.types, conditions.default]) {
      assert(existsSync(resolve(root, directory, file)), `${name}${subpath}: missing ${file}`);
    }
  }
  console.log(`✓ ${name}@${manifest.version} passes npm publish verification`);
}

const releaseTag =
  process.argv.find((argument) => /^v\d/u.test(argument)) ?? process.env.RELEASE_TAG;
if (releaseTag) {
  assert(
    releaseTag === `v${rootPackage.version}`,
    `release tag ${releaseTag} does not match v${rootPackage.version}`,
  );
}

function assertExports(actual) {
  assert(
    z.record(z.string(), z.object({ types: z.string(), default: z.string() })).safeParse(actual)
      .success,
    `${name} must use conditional exports with types and default`,
  );
  assertSet(Object.keys(actual), expectedExports, `${name} has unexpected npm exports`);
  for (const [subpath, conditions] of Object.entries(actual)) {
    if (nonJavaScriptExports.has(subpath)) continue;
    assert(conditions.default.startsWith("./dist/"), `${name}${subpath} must export built JS`);
    assert(conditions.types.startsWith("./dist/"), `${name}${subpath} must export built types`);
  }
}

function assertSet(actual, expected, message) {
  assert(
    Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((entry) => actual.includes(entry)),
    message,
  );
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
