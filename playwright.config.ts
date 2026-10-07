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
    command: `corepack pnpm --filter @strangecyan/vignette-kitchen-sink exec vite --host 127.0.0.1 --port ${String(port)} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
