import { z } from "zod";
import { omitUndefined } from "@strangecyan/vignette-core";
import { getRequestListener } from "@hono/node-server";
import { toSseEvent, AssetManifestWireSchema } from "@strangecyan/vignette-core";
import { createComposerRoot, type CompositionDefinition } from "@strangecyan/vignette";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Plugin } from "vite";

import { createKitchenSinkObsRuntime } from "../server/kitchen-sink-obs.js";

export function vignetteComposer(): Plugin {
  return {
    name: "vignette-node-composer",
    /** Host the composer in the dev server and release its streams when the server closes. */
    async configureServer(server) {
      // Only the optional embedded OBS runtime on this machine needs a local base URL.
      const localUrl = `http://127.0.0.1:${String(server.config.server.port ?? 4173)}/`;
      const reportError = (error: Error) => {
        server.config.logger.error(error.stack ?? error.message);
      };
      const loaded = await Promise.all([
        server.ssrLoadModule("/src/show.tsx"),
        server.ssrLoadModule("virtual:vignette/assets"),
      ]);
      const composition = readCompositionExport(loaded[0]);
      const root = createComposerRoot(composition, {
        assets: z.object({ assets: AssetManifestWireSchema }).parse(loaded[1]).assets,
        onError: reportError,
      });
      await root.render();

      const app = new Hono();
      app.get("/runtime", (context) =>
        streamSSE(context, async (stream) => {
          for await (const message of root.messages(context.req.raw.signal)) {
            await stream.writeSSE(toSseEvent(message));
          }
        }),
      );
      const handleRuntime = getRequestListener(app.fetch);
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?", 1)[0] !== "/runtime") {
          next();
          return;
        }
        void Promise.resolve(handleRuntime(request, response)).catch((cause: unknown) => {
          next(cause);
        });
      });

      const abort = new AbortController();
      let runtime: ReturnType<typeof createKitchenSinkObsRuntime> | undefined = undefined;
      let consumer: Promise<void> | undefined = undefined;
      if (process.env.VIGNETTE_ENABLE_EMBEDDED === "1") {
        const connectedRuntime = createKitchenSinkObsRuntime({
          projectId: composition.id,
          url: process.env.VIGNETTE_OBS_URL ?? "ws://127.0.0.1:4455",
          baseUrl: localUrl,
          ...omitUndefined({ password: process.env.VIGNETTE_OBS_PASSWORD }),
          onError: reportError,
        });
        runtime = connectedRuntime;
        consumer = import("@strangecyan/vignette-core").then(({ consumeRuntimeMessages }) =>
          consumeRuntimeMessages(connectedRuntime, root.messages(abort.signal)),
        );
      }
      server.httpServer?.once("close", () => {
        abort.abort();
        void Promise.all([root.dispose(), consumer, runtime?.dispose()]).catch((cause: unknown) => {
          reportError(cause instanceof Error ? cause : new Error(String(cause)));
        });
      });
    },
  };
}

/** A composition module exports its definition as `composition`. */
const CompositionModuleSchema = z.object({
  composition: z.custom<CompositionDefinition>(
    (value) =>
      z
        .object({ id: z.string(), canvas: z.object({}), component: z.instanceof(Function) })
        .safeParse(value).success,
  ),
});

type CompositionModule = z.output<typeof CompositionModuleSchema>;

function readCompositionExport(
  module: Parameters<typeof CompositionModuleSchema.parse>[0],
): CompositionDefinition {
  const parsed: CompositionModule = CompositionModuleSchema.parse(module);
  return parsed.composition;
}
