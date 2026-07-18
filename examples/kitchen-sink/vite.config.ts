import { defineConfig } from "vite";
import { vignette } from "@strangecyan/vignette-vite";
import { fileURLToPath } from "node:url";

import { vignetteComposer } from "./src/backend/plugin.js";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export const viteConfig = defineConfig({
  plugins: [vignette(), vignetteComposer()],
  server: { host: "127.0.0.1", port: 4173, strictPort: true },
  // The composer wraps the SSR-loaded scene in providers imported through Node. The frame package
  // must resolve to that same module instance or React context identity breaks.
  ssr: { external: ["@strangecyan/vignette-frame"] },
  build: {
    outDir: "dist/client",
    rollupOptions: {
      preserveEntrySignatures: "strict",
      input: {
        app: fromRoot("./index.html"),
      },
    },
  },
});

// eslint-disable-next-line no-restricted-syntax -- Vite discovers configuration through a default export.
export default viteConfig;
