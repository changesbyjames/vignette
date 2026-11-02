import { defineConfig } from "vitest/config";

export const vitestConfig = defineConfig({
  test: {
    include: ["packages/**/*.test.{ts,tsx}", "examples/**/src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    passWithNoTests: true,
    restoreMocks: true,
  },
});

export default vitestConfig;
