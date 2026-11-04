import { builtinModules } from "node:module";
import { defineConfig } from "oxlint";
import baseConfig from "./oxlint-base.json" with { type: "json" };

const src = "packages/vignette/src";

/** A relative import that reaches into one of the named `src/` directories. */
function intoDirectories(directories: readonly string[], message: string) {
  return {
    regex: `^\\.{1,2}/(?:\\.\\./)*(?:${directories.join("|")})(?:/|$)`,
    message,
  };
}

const nodeBuiltins = {
  regex: `^(?:node:|(?:${builtinModules.map((name) => name.replace("/", "\\/")).join("|")})(?:/|$))`,
  message: "This directory runs outside Node; Node built-ins are not allowed here.",
};

const environmentPackages = {
  regex: "^(?:react-dom|obs-websocket-js|playwright|vite|@tanstack/react-query)(?:/|$)",
  message: "This directory is environment-neutral; environment-specific packages are not allowed.",
};

/** Directory import boundaries inside the single `@strangecyan/vignette` package (see AGENTS.md). */
const boundaryOverrides = [
  {
    // Environment-neutral code: the composer, data model, stream and target contracts.
    files: ["core", "stream", "compose", "react-authoring", "target"].map(
      (directory) => `${src}/${directory}/**`,
    ),
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            nodeBuiltins,
            environmentPackages,
            intoDirectories(
              ["obs", "dom", "react", "frame", "bundle", "vite", "cli"],
              "Environment-neutral code must not import a target, client or tooling directory.",
            ),
          ],
        },
      ],
    },
  },
  {
    files: [`${src}/obs/**`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            intoDirectories(["dom", "react"], "The OBS target must not import browser targets."),
          ],
        },
      ],
    },
  },
  {
    files: [`${src}/dom/**`, `${src}/react/**`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            nodeBuiltins,
            intoDirectories(["obs"], "Browser targets must not import the OBS target."),
          ],
        },
      ],
    },
  },
  {
    // Tests run in Node and may read fixtures from disk.
    files: [`${src}/**/*.test.{ts,tsx}`],
    rules: { "no-restricted-imports": "off" },
  },
];

export default defineConfig({
  // Preserve the supported ESLint rules and their file-specific overrides.
  extends: [baseConfig],
  ignorePatterns: [
    "**/dist/**",
    "**/coverage/**",
    "**/node_modules/**",
    "reference/**",
    "plans/**",
    "test-results/**",
    "playwright-report/**",
    // Generated from yoga-layout by packages/vignette/scripts/vendor-yoga.mjs.
    "packages/vignette/vendor/**",
    // Keep the copied plugins identical to their upstream sources.
    "tools/**",
  ],
  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    { name: "house", specifier: "./tools/oxlint/house/index.ts" },
  ],
  overrides: boundaryOverrides,
  rules: {
    "init-declarations": ["error", "always"],
    complexity: ["error", 10],
    "house/no-inline-object-type": "error",
    "house/no-object-freeze": "error",
    "house/no-private-class-fields": "error",
    "house/require-complexity-comment": "error",
    "house/require-pascal-case-schema-name": "error",
    "house/require-zod-output-type": "error",
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",
  },
});
