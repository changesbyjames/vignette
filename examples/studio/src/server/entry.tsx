import { createClientManifestModuleHost } from "@cbj/vignette-frame/server";
import { createComposerHost, type ComposerHost } from "@cbj/vignette-server";
import { createServer, type Server } from "node:http";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Show } from "../show.js";
import { serveStaticFile } from "./static.js";
import {
  createStudioManifest,
  STUDIO_CANVAS,
  STUDIO_EXTENSIONS,
  STUDIO_PROJECT_ID,
} from "./studio.js";

const port = readPort(process.env.PORT);
const hostname = process.env.HOST ?? "127.0.0.1";
const origin = readOrigin(process.env.VIGNETTE_ORIGIN ?? `http://${hostname}:${String(port)}`);
const serverDirectory = dirname(fileURLToPath(import.meta.url));
const clientDirectory = resolve(serverDirectory, "../client");
const reportError = (error: Error) => {
  console.error(error.stack ?? error.message);
};

const host = createComposerHost({
  projectId: STUDIO_PROJECT_ID,
  canvas: STUDIO_CANVAS,
  extensions: STUDIO_EXTENSIONS,
  scene: <Show />,
  frameOrigin: origin,
  frames: await createClientManifestModuleHost({
    clientDirectory,
    clientHelperEntry: "src/frame-client-entry.ts",
  }),
  manifest: createStudioManifest(origin),
});
host.addEventListener("error", (event) => {
  reportError(event.error);
});

const server = createServer((request, response) => {
  void handleRequest(host, request, response, clientDirectory);
});

try {
  await listen(server, port, hostname);
  await host.start();
  console.log(`Vignette studio listening at ${origin}`);
} catch (error: unknown) {
  if (server.listening) await closeServer(server);
  await host.close();
  throw error;
}

let shutdownPromise: Promise<void> | undefined;
const shutdown = () => {
  shutdownPromise ??= Promise.all([closeServer(server), host.close()]).then(() => undefined);
  return shutdownPromise;
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

async function handleRequest(
  composerHost: ComposerHost,
  request: Parameters<ComposerHost["handleRequest"]>[0],
  response: Parameters<ComposerHost["handleRequest"]>[1],
  staticRoot: string,
): Promise<void> {
  try {
    if (await composerHost.handleRequest(request, response)) return;
    if (await serveStaticFile(request, response, staticRoot)) return;
    response.statusCode = 404;
    response.end("Not found.");
  } catch (error: unknown) {
    if (!response.headersSent) {
      response.statusCode = 500;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
    }
    response.end(error instanceof Error ? error.message : "Request failed.");
    reportError(error instanceof Error ? error : new Error(String(error)));
  }
}

function listen(serverToStart: Server, listenPort: number, listenHostname: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    serverToStart.once("error", reject);
    serverToStart.listen(listenPort, listenHostname, () => {
      serverToStart.removeListener("error", reject);
      resolvePromise();
    });
  });
}

function closeServer(serverToClose: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    serverToClose.close((error) => {
      if (error === undefined) resolvePromise();
      else reject(error);
    });
  });
}

function readPort(raw: string | undefined): number {
  const value = raw === undefined ? 4173 : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`PORT must be an integer from 1 to 65535; received '${raw ?? ""}'.`);
  }
  return value;
}

function readOrigin(raw: string): string {
  const value = new URL(raw);
  if (
    (value.protocol !== "http:" && value.protocol !== "https:") ||
    value.pathname !== "/" ||
    value.search !== "" ||
    value.hash !== ""
  ) {
    throw new Error("VIGNETTE_ORIGIN must be an HTTP(S) origin without a path, query, or hash.");
  }
  return value.origin;
}
