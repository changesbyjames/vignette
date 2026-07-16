import { defineConfig } from "vite";
import { FrameRouteRegistry, vignetteFrames } from "@cbj/vignette-frame/vite";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { vignetteComposer } from "./src/backend/plugin.js";

const frameRegistry = new FrameRouteRegistry();
const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export const viteConfig = defineConfig({
  plugins: [vignetteFrames(frameRegistry), vignetteComposer(frameRegistry)],
  server: { host: "127.0.0.1", port: 4173, strictPort: true },
  // The composer host wraps the SSR-loaded scene in providers imported through Node. The frame
  // package must resolve to that same module instance inside ssrLoadModule, or React context
  // identity breaks between <FrameProvider> and <View>.
  ssr: { external: ["@cbj/vignette-frame"] },
  build: {
    outDir: "dist/client",
    manifest: true,
    rollupOptions: {
      preserveEntrySignatures: "strict",
      input: {
        app: fromRoot("./index.html"),
        "frame-client": fromRoot("./src/frame-client-entry.ts"),
        // Every *.frame.tsx module is a client entry so production hydration imports can
        // resolve through the build manifest.
        ...frameModuleInputs(fromRoot("./src")),
      },
    },
  },
});

// eslint-disable-next-line no-restricted-syntax -- Vite discovers configuration through a default export.
export default viteConfig;

function frameModuleInputs(sourceDirectory: string): Readonly<Record<string, string>> {
  const inputs: Record<string, string> = {};
  for (const entry of readdirSync(sourceDirectory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".frame.tsx")) continue;
    const path = join(entry.parentPath, entry.name);
    const name = relative(sourceDirectory, path)
      .replaceAll(/[\\/]/gu, "-")
      .slice(0, -".frame.tsx".length);
    inputs[`${name}-frame`] = path;
  }
  return inputs;
}
