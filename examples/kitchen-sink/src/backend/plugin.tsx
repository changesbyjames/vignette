import type { FrameRouteRegistry } from "@cbj/vignette-frame/server";
import { createDevServerModuleHost } from "@cbj/vignette-frame/vite";
import { createComposerHost } from "@cbj/vignette-server";
import { createNodeRequestHandler } from "@cbj/vignette-server/node";
import { createElement, type ComponentType } from "react";
import type { Plugin } from "vite";

import {
  KITCHEN_SINK_CANVAS,
  KITCHEN_SINK_EXTENSIONS,
  KITCHEN_SINK_PROJECT_ID,
} from "../server/kitchen-sink.js";
import { createKitchenSinkObsRuntime } from "../server/kitchen-sink-obs.js";

const DEV_ORIGIN = "http://127.0.0.1:4173";

export function vignetteComposer(frameRegistry: FrameRouteRegistry): Plugin {
  return {
    name: "vignette-node-composer",
    configureServer(server) {
      const reportError = (error: Error) => {
        server.config.logger.error(error.stack ?? error.message);
      };
      const host = createComposerHost({
        projectId: KITCHEN_SINK_PROJECT_ID,
        canvas: KITCHEN_SINK_CANVAS,
        extensions: KITCHEN_SINK_EXTENSIONS,
        // The scene loads through Vite's SSR pipeline so the frame transform applies in dev.
        scene: async () =>
          createElement(readShowExport(await server.ssrLoadModule("/src/show.tsx"))),
        frameOrigin: DEV_ORIGIN,
        frames: createDevServerModuleHost(server),
        frameRegistry,
        manifest: { version: 1, assets: [] },
      });
      host.addEventListener("error", (event) => {
        reportError(event.error);
      });
      const handleRequest = createNodeRequestHandler(host);
      if (process.env.VIGNETTE_ENABLE_EMBEDDED === "1") {
        host.connect(
          createKitchenSinkObsRuntime({
            url: process.env.VIGNETTE_OBS_URL ?? "ws://127.0.0.1:4455",
            ...(process.env.VIGNETTE_OBS_PASSWORD === undefined
              ? {}
              : { password: process.env.VIGNETTE_OBS_PASSWORD }),
            onError: reportError,
          }),
        );
      }

      const httpServer = server.httpServer;
      const start = () => {
        void host.start().catch((error: unknown) => {
          reportError(error instanceof Error ? error : new Error(String(error)));
        });
      };
      if (httpServer?.listening === true) start();
      else httpServer?.once("listening", start);

      server.middlewares.use((request, response, next) => {
        void handleRequest(request, response).then(
          (handled) => {
            if (!handled) next();
          },
          (error: unknown) => {
            next(error);
          },
        );
      });

      httpServer?.once("close", () => {
        httpServer.removeListener("listening", start);
        void host.close().catch(reportError);
      });
    },
  };
}

function readShowExport(module: unknown): ComponentType {
  const Show = (module as Record<string, unknown> | null)?.Show;
  if (typeof Show !== "function")
    throw new Error("The kitchen-sink composer must export a Show component.");
  return Show as ComponentType;
}
