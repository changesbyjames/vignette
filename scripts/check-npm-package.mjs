import { z } from "zod";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = "git+https://github.com/changesbyjames/vignette.git";
// The packages the release workflow publishes, all at the root's version.
const packages = [
  {
    directory: "packages/vignette",
    name: "@strangecyan/vignette",
    files: ["bin", "dist", "vendor"],
    exports: [
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
    ],
    // Heavy tools only some commands need: optional peers, imported lazily, never dependencies.
    optionalPeers: ["vite", "playwright"],
    // Exports that publish binary assets rather than built JavaScript.
    nonJavaScriptExports: ["./yoga.wasm"],
  },
  {
    directory: "packages/moq",
    name: "@strangecyan/vignette-moq",
    files: ["dist"],
    exports: [".", "./react", "./dom", "./obs"],
    // Only the React plugin needs React.
    optionalPeers: ["react"],
    nonJavaScriptExports: [],
    // Released together, so it asks for the Vignette of its own release.
    sameReleasePeers: ["@strangecyan/vignette"],
  },
];

const rootPackage = readJson("package.json");
for (const expected of packages) checkPackage(expected);

const releaseTag =
  process.argv.find((argument) => /^v\d/u.test(argument)) ?? process.env.RELEASE_TAG;
if (releaseTag) {
  assert(
    releaseTag === `v${rootPackage.version}`,
    `release tag ${releaseTag} does not match v${rootPackage.version}`,
  );
}

function checkPackage(expected) {
  const { directory, name } = expected;
  assert(existsSync(resolve(root, directory, "package.json")), `${name} is missing package.json`);
  const manifest = readJson(`${directory}/package.json`);
  checkManifest(expected, manifest);
  checkPeers(expected, manifest);
  if (!process.argv.includes("--skip-dry-run")) dryRunPublish(expected, manifest);
}

/** The publication contract: publishable, named, versioned with the release, and shipping only what it should. */
function checkManifest({ directory, name, files, exports, nonJavaScriptExports }, manifest) {
  assert(manifest.private === undefined, `${name} must be publishable`);
  assert(manifest.name === name, `${directory} has an unexpected package name`);
  assert(manifest.version === rootPackage.version, `${name} has a mismatched version`);
  assert(manifest.license === "MIT", `${name} must declare its MIT license`);
  assert(manifest.publishConfig?.access === "public", `${name} must publish publicly`);
  assert(manifest.repository?.url === repository, `${name} has an unexpected repository`);
  assert(manifest.repository?.directory === directory, `${name} has an unexpected directory`);
  assertSet(manifest.files, files, `${name} has unexpected published files`);
  assertExports(name, manifest.exports, exports, new Set(nonJavaScriptExports));
}

/** Optional peers stay optional and out of dependencies; same-release peers ask for this release. */
function checkPeers({ name, optionalPeers, sameReleasePeers = [] }, manifest) {
  for (const peer of optionalPeers) {
    // Not a dependency, but a declared peer that is optional.
    assert(manifest.dependencies?.[peer] === undefined, `${name} must not depend on ${peer}`);
    assert(
      manifest.peerDependencies?.[peer] !== undefined,
      `${name} must declare ${peer} as a peer`,
    );
    assert(
      manifest.peerDependenciesMeta?.[peer]?.optional === true,
      `${name} must mark ${peer} as an optional peer`,
    );
  }
  for (const peer of sameReleasePeers) {
    assert(
      manifest.peerDependencies?.[peer] === `^${rootPackage.version}`,
      `${name} must ask for ${peer} ^${rootPackage.version}`,
    );
  }
}

function dryRunPublish({ directory, name }, manifest) {
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

function assertExports(name, actual, expected, nonJavaScriptExports) {
  assert(
    z.record(z.string(), z.object({ types: z.string(), default: z.string() })).safeParse(actual)
      .success,
    `${name} must use conditional exports with types and default`,
  );
  assertSet(Object.keys(actual), expected, `${name} has unexpected npm exports`);
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
