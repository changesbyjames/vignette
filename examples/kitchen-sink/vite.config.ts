import { defineConfig } from "vite";

/**
 * Builds the browser app (`index.html` → `src/main.tsx`) into `dist/client`. In development the
 * app's own Vite server proxies the stream and the bundle to the example server on port 3000.
 */
export const viteConfig = defineConfig({
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    proxy: { "/stream": "http://127.0.0.1:3000", "/vignette": "http://127.0.0.1:3000" },
  },
  resolve: { dedupe: ["react", "react-dom"] },
  build: { outDir: "dist/client" },
});

// oxlint-disable-next-line import/no-default-export -- Vite discovers configuration through a default export.
export default viteConfig;
