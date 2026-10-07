import { defineConfig } from "oxlint";
import baseConfig from "./oxlint-base.json" with { type: "json" };

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
    "packages/vite/test-fixtures/**",
    // Generated from yoga-layout by packages/core/scripts/vendor-yoga.mjs.
    "packages/core/vendor/**",
    // Keep the copied plugins identical to their upstream sources.
    "tools/**",
  ],
  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    { name: "house", specifier: "./tools/oxlint/house/index.ts" },
  ],
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
