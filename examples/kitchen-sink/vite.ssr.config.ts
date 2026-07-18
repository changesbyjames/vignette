import { vignette } from "@strangecyan/vignette-vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export const viteSsrConfig = defineConfig({
  plugins: [vignette()],
  ssr: {
    external: [
      "@strangecyan/vignette-core",
      "@strangecyan/vignette-frame",
      "@strangecyan/vignette-frame/server",
      "@strangecyan/vignette-moq",
      "@strangecyan/vignette-moq/obs",
      "@strangecyan/vignette-moq/react",
      "@strangecyan/vignette",
      "@strangecyan/vignette-target-obs",
      "react",
      "react/jsx-runtime",
    ],
  },
  build: {
    ssr: true,
    outDir: "dist/server",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        host: fileURLToPath(new URL("./src/server/entry.tsx", import.meta.url)),
        "obs-worker": fileURLToPath(new URL("./src/server/obs-worker.ts", import.meta.url)),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
  },
});

// eslint-disable-next-line no-restricted-syntax -- Vite discovers configuration through a default export.
export default viteSsrConfig;
