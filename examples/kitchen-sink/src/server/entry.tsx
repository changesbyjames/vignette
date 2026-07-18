import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { consumeRuntimeMessages, toSseEvent } from "@strangecyan/vignette-core";
import { createSceneStore, SceneProvider } from "@strangecyan/vignette-frame";
import { createFrameRequestHandler } from "@strangecyan/vignette-frame/server";
import { createComposerRoot } from "@strangecyan/vignette";
import { streamSSE } from "hono/streaming";
import { Hono } from "hono";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { assets } from "virtual:vignette/assets";
import { frames } from "virtual:vignette/frames";

import { Show } from "../show.js";
import { createKitchenSinkObsRuntime } from "./kitchen-sink-obs.js";
import {
  KITCHEN_SINK_CANVAS,
  KITCHEN_SINK_EXTENSIONS,
  KITCHEN_SINK_PROJECT_ID,
} from "./kitchen-sink.js";

const port = readPort(process.env.PORT);
const hostname = process.env.HOST ?? "127.0.0.1";
const origin = readOrigin(process.env.VIGNETTE_ORIGIN ?? `http://${hostname}:${String(port)}`);
const clientDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../client");
const reportError = (error: Error) => {
  console.error(error.stack ?? error.message);
};
const scene = createSceneStore({ origin });
const root = createComposerRoot({
  projectId: KITCHEN_SINK_PROJECT_ID,
  canvas: KITCHEN_SINK_CANVAS,
  extensions: KITCHEN_SINK_EXTENSIONS,
  assets,
  onError: reportError,
});
await root.render(
  <SceneProvider scene={scene}>
    <Show />
  </SceneProvider>,
);

const handleFrame = createFrameRequestHandler(frames);
const app = new Hono();
app.get("/runtime", (context) =>
  streamSSE(context, async (stream) => {
    for await (const message of root.messages(context.req.raw.signal)) {
      await stream.writeSSE(toSseEvent(message));
    }
  }),
);
app.all(
  "/__vignette/*",
  async (context) => (await handleFrame(context.req.raw)) ?? context.notFound(),
);
app.use("/*", serveStatic({ root: clientDirectory }));

const server = serve({ fetch: app.fetch, port, hostname });
const runtimeAbort = new AbortController();
let runtime: ReturnType<typeof createKitchenSinkObsRuntime> | undefined;
let runtimeConsumer: Promise<void> | undefined;
if (process.env.VIGNETTE_ENABLE_EMBEDDED === "1") {
  runtime = createKitchenSinkObsRuntime({
    url: process.env.VIGNETTE_OBS_URL ?? "ws://127.0.0.1:4455",
    ...(process.env.VIGNETTE_OBS_PASSWORD === undefined
      ? {}
      : { password: process.env.VIGNETTE_OBS_PASSWORD }),
    onError: reportError,
  });
  runtimeConsumer = consumeRuntimeMessages(runtime, root.messages(runtimeAbort.signal)).catch(
    (cause: unknown) => {
      reportError(cause instanceof Error ? cause : new Error(String(cause)));
    },
  );
}
console.log(`Vignette kitchen sink listening at ${origin}`);

let shutdownPromise: Promise<void> | undefined;
const shutdown = () => {
  shutdownPromise ??= (async () => {
    runtimeAbort.abort();
    await closeServer();
    await root.dispose();
    await runtimeConsumer;
    await runtime?.dispose();
  })();
  return shutdownPromise;
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

function closeServer(): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => {
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
