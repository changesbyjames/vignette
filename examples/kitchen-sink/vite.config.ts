import { defineConfig } from "vite";
import { vignette } from "@strangecyan/vignette-vite";
import { fileURLToPath } from "node:url";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export const viteConfig = defineConfig({
  plugins: [
    vignette({
      // `vite dev` composes this module's `composition` export and streams it at /runtime.
      composition: "./src/show.tsx",
      async onComposerRoot(root, { composition, server, signal }) {
        // Optionally drive a disposable local OBS instance from the dev composer.
        if (process.env.VIGNETTE_ENABLE_EMBEDDED !== "1") return;
        const [{ consumeRuntimeMessages, omitUndefined }, { createKitchenSinkObsRuntime }] =
          await Promise.all([
            import("@strangecyan/vignette-core"),
            import("./src/server/kitchen-sink-obs.js"),
          ]);
        const runtime = createKitchenSinkObsRuntime({
          projectId: composition.id,
          url: process.env.VIGNETTE_OBS_URL ?? "ws://127.0.0.1:4455",
          // Only this local runtime needs an address to resolve root-relative frame URLs.
          baseUrl: `http://127.0.0.1:${String(server.config.server.port ?? 4173)}/`,
          ...omitUndefined({ password: process.env.VIGNETTE_OBS_PASSWORD }),
          onError: (error) => {
            server.config.logger.error(error.stack ?? error.message);
          },
        });
        try {
          await consumeRuntimeMessages(runtime, root.messages(signal));
        } finally {
          await runtime.dispose();
        }
      },
    }),
  ],
  server: { host: "127.0.0.1", port: 4173, strictPort: true },
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
