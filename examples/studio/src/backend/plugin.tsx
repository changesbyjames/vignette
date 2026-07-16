import type { FrameRouteRegistry } from "@cbj/react-obs-frame/server";
import { createDevServerModuleHost } from "@cbj/react-obs-frame/vite";
import { createComposerHost } from "@cbj/react-obs-server";
import { createElement, type ComponentType } from "react";
import type { Plugin } from "vite";

import {
  createStudioManifest,
  STUDIO_CANVAS,
  STUDIO_EXTENSIONS,
  STUDIO_PROJECT_ID,
} from "../server/studio.js";
import { createStudioObsRuntime } from "../server/studio-obs.js";

const DEV_ORIGIN = "http://127.0.0.1:4173";

export function reactObsComposer(frameRegistry: FrameRouteRegistry): Plugin {
  return {
    name: "react-obs-node-composer",
    configureServer(server) {
      const reportError = (error: Error) => {
        server.config.logger.error(error.stack ?? error.message);
      };
      const host = createComposerHost({
        projectId: STUDIO_PROJECT_ID,
        canvas: STUDIO_CANVAS,
        extensions: STUDIO_EXTENSIONS,
        // The scene loads through Vite's SSR pipeline so the frame transform applies in dev.
        scene: async () =>
          createElement(readShowExport(await server.ssrLoadModule("/src/show.tsx"))),
        frameOrigin: DEV_ORIGIN,
        frames: createDevServerModuleHost(server),
        frameRegistry,
        manifest: createStudioManifest(DEV_ORIGIN),
      });
      host.addEventListener("error", (event) => {
        reportError(event.error);
      });
      if (process.env.REACT_OBS_ENABLE_EMBEDDED === "1") {
        host.connect(
          createStudioObsRuntime({
            url: process.env.REACT_OBS_URL ?? "ws://127.0.0.1:4455",
            ...(process.env.REACT_OBS_PASSWORD === undefined
              ? {}
              : { password: process.env.REACT_OBS_PASSWORD }),
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
        void host.handleRequest(request, response).then(
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
    throw new Error("The studio composer must export a Show component.");
  return Show as ComponentType;
}
