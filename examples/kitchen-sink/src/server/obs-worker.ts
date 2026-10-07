import { consumeStream } from "@strangecyan/vignette-core";
import { sseStream } from "@strangecyan/vignette-target-obs";
import process from "node:process";

import { composition } from "../show.js";
import { createKitchenSinkObsRuntime } from "./kitchen-sink-obs.js";

const streamUrl = process.env.VIGNETTE_STREAM_URL ?? "http://127.0.0.1:4173/stream";
const reportError = (error: Error): void => {
  console.error(error.stack ?? error.message);
};
const runtime = createKitchenSinkObsRuntime({
  projectId: composition.id,
  url: process.env.VIGNETTE_OBS_URL ?? "ws://127.0.0.1:4455",
  baseUrl: streamUrl,
  browserSourceBaseUrl: process.env.VIGNETTE_BROWSER_SOURCE_BASE_URL,
  password: process.env.VIGNETTE_OBS_PASSWORD,
  onError: reportError,
});
const controller = new AbortController();
const shutdown = (): void => {
  controller.abort();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

console.log(`Vignette worker consuming ${streamUrl}`);
try {
  await consumeStream(runtime, sseStream(streamUrl, { onError: reportError })(controller.signal));
} finally {
  await runtime.dispose();
}
