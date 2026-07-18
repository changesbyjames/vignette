import { defineConfig } from "@playwright/test";
import process from "node:process";

export default defineConfig({
  testDir: "./examples/kitchen-sink/tests",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "corepack pnpm --filter @strangecyan/vignette-kitchen-sink exec vite --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
