import { FrameRouteRegistry, reactObsFrames } from "@cbj/react-obs-frame/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export const viteSsrConfig = defineConfig({
  plugins: [reactObsFrames(new FrameRouteRegistry())],
  ssr: {
    external: [
      "@cbj/react-obs-core",
      "@cbj/react-obs-frame",
      "@cbj/react-obs-frame/server",
      "@cbj/react-obs-moq",
      "@cbj/react-obs-moq/obs",
      "@cbj/react-obs-moq/react",
      "@cbj/react-obs",
      "@cbj/react-obs-server",
      "@cbj/react-obs-target-obs",
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
