import { defineConfig } from "vitest/config";

export const vitestConfig = defineConfig({
  test: {
    include: ["packages/**/*.{test,spec}.{ts,tsx}", "examples/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["examples/studio/tests/**", "**/node_modules/**", "**/dist/**"],
    passWithNoTests: true,
    restoreMocks: true,
  },
});

export default vitestConfig;
