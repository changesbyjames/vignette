import { FrameRouteRegistry, vignetteFrames } from "@cbj/vignette-frame/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export const viteSsrConfig = defineConfig({
  plugins: [vignetteFrames(new FrameRouteRegistry())],
  ssr: {
    external: [
      "@cbj/vignette-core",
      "@cbj/vignette-frame",
      "@cbj/vignette-frame/server",
      "@cbj/vignette-moq",
      "@cbj/vignette-moq/obs",
      "@cbj/vignette-moq/react",
      "@cbj/vignette",
      "@cbj/vignette-server",
      "@cbj/vignette-target-obs",
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
