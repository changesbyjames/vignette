/**
 * The kitchen sink's production server, the README §4 recipe on Hono: compose the show, publish
 * where things are served, put the stream on SSE, and serve the bundle and the preview app.
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

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? "127.0.0.1";
const origin = process.env.PUBLIC_ORIGIN ?? `http://127.0.0.1:${String(port)}`;
const bundleDir = fileURLToPath(new URL("../../public/vignette", import.meta.url));
const clientDir = fileURLToPath(new URL("../client", import.meta.url));

// Steps 1–2 ran at build time: `tsc` compiled the show, scripts/bundle.mjs wrote public/vignette.
const manifest = AssetManifestSchema.parse(
  JSON.parse(await readFile(`${bundleDir}/assets.json`, "utf8")),
);

// Step 3: run the composer and tell it where step 2's output and the stream are served.
const composer = compose(show, {
  assets: manifest,
  serve: {
    stream: `${origin}/stream`,
    assets: `${origin}/vignette/assets/`,
    frames: `${origin}/vignette/frames.html`,
  },
  onError: (error) => {
    console.error(error);
  },
});
await composer.ready();

const app = new Hono();

// Step 4: put the stream on a wire.
app.get("/stream", (context) =>
  streamSSE(context, async (sse) => {
    // A frame page asks for its one source with `?source=`.
    const options = streamOptions(context.req.url);
    for await (const message of composer.stream(context.req.raw.signal, options)) {
      await sse.writeSSE(toSseEvent(message));
    }
  }),
);

// Step 5: serve the bundle directory at the URLs stated in step 3, and the preview app at `/`.
app.use(
  "/vignette/*",
  serveStatic({ root: bundleDir, rewriteRequestPath: (path) => path.replace(/^\/vignette/u, "") }),
);
app.use("/*", serveStatic({ root: clientDir }));

// Optional: drive OBS from this process, reading the composer directly.
const obs =
  process.env.OBS_URL === undefined
    ? undefined
    : obsTarget({
        url: process.env.OBS_URL,
        password: process.env.OBS_PASSWORD,
        sources: [moqObs],
      });
obs?.follow(composer.stream());

const server = serve({ fetch: app.fetch, port, hostname });
console.log(
  `Vignette kitchen sink at http://${hostname}:${String(port)}/ (stream ${origin}/stream)`,
);

const shutdown = () => {
  // Ends every stream response; a target that reconnects meanwhile gets an empty stream.
  composer.dispose();
  void obs?.dispose();
  // Stop accepting, and drop the kept-alive sockets reconnecting targets would otherwise reuse.
  server.close();
  if ("closeAllConnections" in server) server.closeAllConnections();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
