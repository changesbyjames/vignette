// Regenerates packages/core/vendor/yoga from the pinned yoga-layout dependency.
//
// yoga-layout embeds its WebAssembly as base64 and compiles it at runtime, which runtimes such as
// Cloudflare Workers forbid. This script splits the same build into a standalone `yoga.wasm` (so a
// bundler can import it as a precompiled WebAssembly.Module) and the Emscripten/wrapper JavaScript
// without the embedded bytes. Run `pnpm --filter @strangecyan/vignette-core vendor:yoga` after
// changing the yoga-layout version; core's layout tests fail while the vendored copy is stale.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const coreRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(coreRoot, "vendor/yoga");
const yogaRoot = resolve(
  dirname(createRequire(resolve(coreRoot, "package.json")).resolve("yoga-layout/load")),
  "../..",
);
const corePackage = JSON.parse(readFileSync(resolve(coreRoot, "package.json"), "utf8"));
const yogaPackage = JSON.parse(readFileSync(resolve(yogaRoot, "package.json"), "utf8"));
if (corePackage.dependencies["yoga-layout"] !== yogaPackage.version) {
  throw new Error(
    `Installed yoga-layout ${yogaPackage.version} does not match core's pinned ${corePackage.dependencies["yoga-layout"]}.`,
  );
}

const DATA_URI = /"data:application\/octet-stream;base64,([A-Za-z0-9+/=]{64,})"/u;
const glue = readFileSync(resolve(yogaRoot, "dist/binaries/yoga-wasm-base64-esm.js"), "utf8");
const match = DATA_URI.exec(glue);
if (match === null) throw new Error("yoga-layout no longer embeds its Wasm as a base64 data URI.");
const header = (source) =>
  `// Generated from yoga-layout@${yogaPackage.version} (${source}) by packages/core/scripts/vendor-yoga.mjs.\n` +
  "// Copyright (c) Meta Platforms, Inc. and affiliates. MIT licensed; see ./LICENSE. Do not edit.\n";
const stripSourceMap = (code) => code.replace(/\n\/\/# sourceMappingURL=.*$/u, "\n");

mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, "yoga.wasm"), Buffer.from(match[1], "base64"));
writeFileSync(
  resolve(output, "yoga-wasm-glue.js"),
  // The bytes now live in yoga.wasm; callers must supply `instantiateWasm`.
  header("dist/binaries/yoga-wasm-base64-esm.js") + glue.replace(DATA_URI, '""'),
);
writeFileSync(
  resolve(output, "wrap-assembly.js"),
  header("dist/src/wrapAssembly.js") +
    stripSourceMap(readFileSync(resolve(yogaRoot, "dist/src/wrapAssembly.js"), "utf8")).replaceAll(
      "./generated/YGEnums.js",
      "./yg-enums.js",
    ),
);
writeFileSync(
  resolve(output, "yg-enums.js"),
  header("dist/src/generated/YGEnums.js") +
    stripSourceMap(readFileSync(resolve(yogaRoot, "dist/src/generated/YGEnums.js"), "utf8")),
);
console.log(`Vendored yoga-layout@${yogaPackage.version} into ${output}`);
