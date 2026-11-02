import { defineConfig } from "@playwright/test";
import process from "node:process";

const port = Number(process.env.VIGNETTE_TEST_PORT ?? 4173);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("VIGNETTE_TEST_PORT must be an integer between 1 and 65535.");
}
const baseURL = `http://127.0.0.1:${String(port)}`;

export default defineConfig({
  testDir: "./examples/kitchen-sink/tests",
  timeout: 30_000,
  use: {
    baseURL,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    // The kitchen sink's production server: the built show, its bundle and the preview app.
    // Run `pnpm build` first (`pnpm ready` does).
    command: "corepack pnpm --filter @vignette/kitchen-sink start",
    env: { PORT: String(port) },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
