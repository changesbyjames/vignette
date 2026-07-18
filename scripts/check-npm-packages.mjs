import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootPackage = readJson("package.json");
const repository = "git+https://github.com/changesbyjames/vignette.git";
const packages = [
  packageConfig("packages/core", "@strangecyan/vignette-core", [
    ".",
    "./builders",
    "./layout-yoga",
    "./runtime",
    "./sse",
  ]),
  packageConfig(
    "packages/target-dom",
    "@strangecyan/vignette-target-dom",
    [".", "./react"],
    ["@strangecyan/vignette-core"],
  ),
  packageConfig(
    "packages/target-obs",
    "@strangecyan/vignette-target-obs",
    ["."],
    ["@strangecyan/vignette-core"],
  ),
  packageConfig("packages/react", "@strangecyan/vignette", ["."], ["@strangecyan/vignette-core"]),
  packageConfig(
    "packages/frame",
    "@strangecyan/vignette-frame",
    [
      ".",
      "./client",
      "./remote-store",
      "./remote-store/client",
      "./remote-store/server",
      "./server",
      "./server/node",
      "./transform",
    ],
    ["@strangecyan/vignette-core", "@strangecyan/vignette"],
  ),
  packageConfig(
    "packages/vite",
    "@strangecyan/vignette-vite",
    [".", "./frame-client", "./virtual"],
    ["@strangecyan/vignette-core", "@strangecyan/vignette-frame"],
    ["dist", "src/virtual.d.ts"],
  ),
  packageConfig(
    "packages/moq",
    "@strangecyan/vignette-moq",
    [".", "./react", "./dom", "./obs"],
    [
      "@strangecyan/vignette-core",
      "@strangecyan/vignette",
      "@strangecyan/vignette-target-dom",
      "@strangecyan/vignette-target-obs",
    ],
  ),
  packageConfig(
    "packages/testkit",
    "@strangecyan/vignette-testkit",
    ["."],
    ["@strangecyan/vignette-core", "@strangecyan/vignette-target-obs"],
  ),
  packageConfig(
    "packages/preview",
    "@strangecyan/vignette-preview",
    ["."],
    ["@strangecyan/vignette-core", "@strangecyan/vignette-target-dom"],
    ["bin", "dist"],
  ),
];

for (const candidate of packages) {
  const manifest = readJson(`${candidate.directory}/package.json`);

  assert(manifest.private === undefined, `${candidate.name} must be publishable`);
  assert(manifest.name === candidate.name, `${candidate.directory} has an unexpected package name`);
  assert(manifest.version === rootPackage.version, `${candidate.name} has a mismatched version`);
  assert(manifest.license === "MIT", `${candidate.name} must declare its MIT license`);
  assert(manifest.publishConfig?.access === "public", `${candidate.name} must publish publicly`);
  assert(manifest.repository?.url === repository, `${candidate.name} has an unexpected repository`);
  assert(
    manifest.repository?.directory === candidate.directory,
    `${candidate.name} has an unexpected repository directory`,
  );
  assertSet(manifest.files, candidate.files, `${candidate.name} has unexpected published files`);
  assertExports(manifest.exports, candidate.exports, candidate.name);

  for (const dependency of candidate.dependencies) {
    assert(
      manifest.dependencies?.[dependency] === "workspace:^",
      `${candidate.name} must depend on ${dependency} through workspace:^`,
    );
  }

  if (candidate.directory === "packages/preview") {
    assert(
      manifest.bin?.vignette === "./bin/vignette.js",
      `${candidate.name} must publish its CLI`,
    );
  }

  for (const path of ["README.md", "package.json"]) {
    assert(
      existsSync(resolve(root, candidate.directory, path)),
      `${candidate.name} is missing ${path}`,
    );
  }

  if (!process.argv.includes("--skip-dry-run")) {
    execFileSync("pnpm", ["publish", "--dry-run", "--no-git-checks"], {
      cwd: resolve(root, candidate.directory),
      stdio: "inherit",
    });
    console.log(`✓ ${candidate.name}@${manifest.version} passes npm publish verification`);
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

function packageConfig(directory, name, exports, dependencies = [], files = ["dist"]) {
  return { directory, name, exports, dependencies, files };
}

function assertExports(actual, expected, name) {
  assert(
    actual !== undefined && typeof actual !== "string",
    `${name} must use conditional exports`,
  );
  assertSet(Object.keys(actual), expected, `${name} has unexpected npm exports`);
  for (const [subpath, conditions] of Object.entries(actual)) {
    assert(typeof conditions.types === "string", `${name}${subpath} must export types`);
    if (subpath !== "./virtual") {
      assert(typeof conditions.default === "string", `${name}${subpath} must export JavaScript`);
      assert(
        conditions.default.startsWith("./dist/"),
        `${name}${subpath} must export built JavaScript`,
      );
      assert(conditions.types.startsWith("./dist/"), `${name}${subpath} must export built types`);
    }
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
