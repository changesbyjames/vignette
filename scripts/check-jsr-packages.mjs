import { execFileSync } from "node:child_process";
import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootPackage = readJson("package.json");
const packages = [
  packageConfig("packages/core", "@cbj/vignette-core", [
    ".",
    "./builders",
    "./layout-yoga",
    "./runtime",
    "./sse",
  ]),
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
    [".", "./client", "./server", "./server/node", "./transform"],
    ["@cbj/vignette-core", "@cbj/vignette"],
  ),
  packageConfig(
    "packages/vite",
    "@cbj/vignette-vite",
    [".", "./frame-client"],
    ["@cbj/vignette-core", "@cbj/vignette-frame"],
  ),
  packageConfig(
    "packages/moq",
    "@cbj/vignette-moq",
    [".", "./react", "./dom", "./obs"],
    ["@cbj/vignette-core", "@cbj/vignette", "@cbj/vignette-target-dom", "@cbj/vignette-target-obs"],
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
  assert(
    !jsr.publish?.include?.includes("package.json"),
    `${candidate.name} must not publish its local pnpm package.json`,
  );
  assertExports(jsr.exports, candidate.exports, candidate.name);
  assertExplicitImports(jsr.imports, candidate.name);
  assertNoPublishedTsx(jsr.publish, candidate);

  for (const dependency of candidate.dependencies) {
    assert(
      manifest.dependencies?.[dependency] === "workspace:^",
      `${candidate.name} must depend on ${dependency} through workspace:^`,
    );
    assert(
      jsr.imports?.[dependency] === `jsr:${dependency}@^${jsr.version}`,
      `${candidate.name} has a mismatched JSR dependency on ${dependency}`,
    );
  }

  for (const [dependency, version] of Object.entries({
    ...manifest.dependencies,
    ...manifest.peerDependencies,
  })) {
    if (candidate.dependencies.includes(dependency)) continue;
    assertNpmImport(jsr.imports, dependency, version, candidate.name);
  }

  for (const path of ["README.md", "deno.json", "package.json"]) {
    assert(
      existsSync(resolve(root, candidate.directory, path)),
      `${candidate.name} is missing ${path}`,
    );
  }

  if (!process.argv.includes("--skip-dry-run")) {
    const args = ["exec", "jsr", "publish", "--dry-run", "--allow-dirty"];
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

function packageConfig(directory, name, exports, dependencies = []) {
  return { directory, name, exports, dependencies };
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

function assertExplicitImports(imports = {}, name) {
  assert(
    Object.keys(imports).every((specifier) => !specifier.endsWith("/")),
    `${name} must map JSR subpaths explicitly to avoid duplicate npm compatibility dependencies`,
  );
}

function assertNoPublishedTsx(publish = {}, candidate) {
  // JSR's npm compatibility tarball transpiles .ts but ships .tsx raw, leaving
  // unresolvable ./*.tsx specifiers and duplicate module identities in bundles.
  assert(
    (publish.include ?? []).every((pattern) => !pattern.includes(".tsx")),
    `${candidate.name} must not include .tsx files in its JSR publish set`,
  );
  const shipped = globSync(publish.include ?? [], { cwd: resolve(root, candidate.directory) });
  assert(
    shipped.every((path) => !path.endsWith(".tsx")),
    `${candidate.name} would publish raw .tsx files; convert them to createElement .ts modules`,
  );
}

function assertNpmImport(imports = {}, dependency, version, name) {
  const target = `npm:${dependency}@${version}`;
  assert(
    Object.values(imports).some(
      (specifier) => specifier === target || specifier.startsWith(`${target}/`),
    ),
    `${name} must map ${dependency}@${version} through deno.json`,
  );
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
