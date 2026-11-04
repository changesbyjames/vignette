/**
 * The soak show's server: the kitchen sink's recipe without the preview app. It composes the show,
 * serves the stream and the bundle, drives OBS in this process, and reports what the composer and
 * the target do to the harness that started it.
 */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { moqObs } from "@vignette/moq/obs";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { AssetManifestSchema, compose, streamOptions, toSseEvent } from "vignette";
import { obsTarget } from "vignette/obs";

import show from "../show.js";
import { startProbe, type ProbeMessage } from "./probe.js";

const port = Number(process.env.PORT ?? 3100);
const origin = `http://127.0.0.1:${String(port)}`;
const bundleDir = fileURLToPath(new URL("../../public/vignette", import.meta.url));

const report = (message: ProbeMessage) => {
  if (process.send) process.send(message);
  else console.log(JSON.stringify(message));
};

const manifest = AssetManifestSchema.parse(
  JSON.parse(await readFile(`${bundleDir}/assets.json`, "utf8")),
);
const composer = compose(show, {
  assets: manifest,
  serve: {
    stream: `${origin}/stream`,
    assets: `${origin}/vignette/assets/`,
    frames: `${origin}/vignette/frames.html`,
  },
  onError: (error) => {
    report({ type: "event", event: "composer-error", detail: { message: error.message } });
  },
});
await composer.ready();

const app = new Hono();
app.get("/stream", (context) =>
  streamSSE(context, async (sse) => {
    // A frame page asks for its one source with `?source=`.
    const options = streamOptions(context.req.url);
    for await (const message of composer.stream(context.req.raw.signal, options)) {
      await sse.writeSSE(toSseEvent(message));
    }
  }),
);
app.use(
  "/vignette/*",
  serveStatic({ root: bundleDir, rewriteRequestPath: (path) => path.replace(/^\/vignette/u, "") }),
);

const obs = obsTarget({
  url: process.env.OBS_URL,
  password: process.env.OBS_PASSWORD,
  sources: [moqObs],
});
const stopProbe = startProbe(composer, obs, report);
obs.follow(composer.stream());

const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
report({ type: "event", event: "server-listening", detail: { origin } });

const shutdown = () => {
  stopProbe();
  composer.dispose();
  void obs.dispose().finally(() => {
    server.close();
    if ("closeAllConnections" in server) server.closeAllConnections();
    process.disconnect?.();
  });
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
// The harness asks over IPC, because Windows has no SIGTERM to send.
process.on("message", (message) => {
  if (message === "shutdown") shutdown();
});
