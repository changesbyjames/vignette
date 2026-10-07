import { defineConfig } from "vite";
import { vignette } from "@strangecyan/vignette-vite";
import { fileURLToPath } from "node:url";

import { vignetteComposer } from "./src/backend/plugin.js";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export const viteConfig = defineConfig({
  plugins: [vignette(), vignetteComposer()],
  server: { host: "127.0.0.1", port: 4173, strictPort: true },
  // Load the frame package through Node so SSR-loaded scenes and frame routes share one instance.
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

// oxlint-disable-next-line import/no-default-export -- Vite discovers configuration through a default export.
export default viteConfig;
