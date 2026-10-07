import { z } from "zod";
import { omitUndefined } from "@strangecyan/vignette-core";
import { getRequestListener } from "@hono/node-server";
import { toSseEvent, AssetManifestWireSchema } from "@strangecyan/vignette-core";
import { createComposerRoot } from "@strangecyan/vignette";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { createElement, type ComponentType } from "react";
import type { Plugin } from "vite";

import {
  KITCHEN_SINK_CANVAS,
  KITCHEN_SINK_EXTENSIONS,
  KITCHEN_SINK_PROJECT_ID,
} from "../server/kitchen-sink.js";
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
      const root = createComposerRoot({
        projectId: KITCHEN_SINK_PROJECT_ID,
        canvas: KITCHEN_SINK_CANVAS,
        extensions: KITCHEN_SINK_EXTENSIONS,
        assets: z.object({ assets: AssetManifestWireSchema }).parse(loaded[1]).assets,
        onError: reportError,
      });
      await root.render(createElement(readShowExport(loaded[0])));

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

const ShowModuleSchema = z.object({
  Show: z.custom<ComponentType>((value) => value instanceof Function),
});
type ShowModule = z.output<typeof ShowModuleSchema>;

function readShowExport(module: Parameters<typeof ShowModuleSchema.parse>[0]): ComponentType {
  const parsed: ShowModule = ShowModuleSchema.parse(module);
  return parsed.Show;
}
