import { getRequestListener } from "@hono/node-server";
import { toSseEvent, type AssetManifest } from "@strangecyan/vignette-core";
import { createSceneStore, SceneProvider } from "@strangecyan/vignette-frame";
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

const DEV_ORIGIN = "http://127.0.0.1:4173";

export function vignetteComposer(): Plugin {
  return {
    name: "vignette-node-composer",
    async configureServer(server) {
      const reportError = (error: Error) => {
        server.config.logger.error(error.stack ?? error.message);
      };
      const loaded = await Promise.all([
        server.ssrLoadModule("/src/show.tsx"),
        server.ssrLoadModule("virtual:vignette/assets"),
      ]);
      const scene = createSceneStore({ origin: DEV_ORIGIN });
      const root = createComposerRoot({
        projectId: KITCHEN_SINK_PROJECT_ID,
        canvas: KITCHEN_SINK_CANVAS,
        extensions: KITCHEN_SINK_EXTENSIONS,
        assets: (loaded[1] as { assets: AssetManifest }).assets,
        onError: reportError,
      });
      await root.render(
        createElement(SceneProvider, {
          scene,
          children: createElement(readShowExport(loaded[0])),
        }),
      );

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
        void Promise.resolve(handleRuntime(request, response)).catch((error: unknown) => {
          next(error);
        });
      });

      const abort = new AbortController();
      let runtime: ReturnType<typeof createKitchenSinkObsRuntime> | undefined;
      let consumer: Promise<void> | undefined;
      if (process.env.VIGNETTE_ENABLE_EMBEDDED === "1") {
        const connectedRuntime = createKitchenSinkObsRuntime({
          url: process.env.VIGNETTE_OBS_URL ?? "ws://127.0.0.1:4455",
          ...(process.env.VIGNETTE_OBS_PASSWORD === undefined
            ? {}
            : { password: process.env.VIGNETTE_OBS_PASSWORD }),
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

function readShowExport(module: unknown): ComponentType {
  const Show = (module as Record<string, unknown> | null)?.Show;
  if (typeof Show !== "function") throw new Error("The kitchen-sink composer must export Show.");
  return Show as ComponentType;
}
