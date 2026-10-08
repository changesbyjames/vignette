import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { consumeStream, toSseEvent } from "@strangecyan/vignette-core";
import { createFrameRequestHandler } from "@strangecyan/vignette-frame/server";
import { createComposerRoot } from "@strangecyan/vignette";
import { streamSSE } from "hono/streaming";
import { Hono } from "hono";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { assets } from "virtual:vignette/assets";
import { frames } from "virtual:vignette/frames";

import { composition } from "../show.js";
import { createKitchenSinkObsRuntime } from "./kitchen-sink-obs.js";

const port = readPort(process.env.PORT);
const hostname = process.env.HOST ?? "127.0.0.1";
// The composer never needs its public origin; only the embedded OBS runtime, which runs on this
// machine, needs a local address to reach frames and assets.
const localUrl = `http://${hostname === "0.0.0.0" || hostname === "::" ? "127.0.0.1" : hostname}:${String(port)}/`;
const clientDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../client");
const reportError = (error: Error) => {
  console.error(error.stack ?? error.message);
};
const root = createComposerRoot(composition, { assets, onError: reportError });
await root.render();

const handleFrame = createFrameRequestHandler(frames);
const app = new Hono();
app.get("/stream", (context) =>
  streamSSE(context, async (stream) => {
    for await (const message of root.messages(context.req.raw.signal)) {
      await stream.writeSSE(toSseEvent(message));
    }
  }),
);
app.all("/__vignette/*", (context) => handleFrame(context.req.raw) ?? context.notFound());
app.use("/*", serveStatic({ root: clientDirectory }));

const server = serve({ fetch: app.fetch, port, hostname });
const runtimeAbort = new AbortController();
let runtime: ReturnType<typeof createKitchenSinkObsRuntime> | undefined = undefined;
let runtimeConsumer: Promise<void> | undefined = undefined;
if (process.env.VIGNETTE_ENABLE_EMBEDDED === "1") {
  runtime = createKitchenSinkObsRuntime({
    projectId: composition.id,
    url: process.env.VIGNETTE_OBS_URL ?? "ws://127.0.0.1:4455",
    baseUrl: localUrl,
    password: process.env.VIGNETTE_OBS_PASSWORD,
    onError: reportError,
  });
  runtimeConsumer = consumeStream(runtime, root.messages(runtimeAbort.signal)).catch(
    (cause: unknown) => {
      reportError(cause instanceof Error ? cause : new Error(String(cause)));
    },
  );
}
console.log(`Vignette kitchen sink listening at ${localUrl}`);

let shutdownPromise: Promise<void> | undefined = undefined;
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

/** Use the default port when absent and reject non-integer values outside the TCP port range. */
function readPort(raw: string | undefined): number {
  const value = raw === undefined ? 4173 : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`PORT must be an integer from 1 to 65535; received '${raw ?? ""}'.`);
  }
  return value;
}
