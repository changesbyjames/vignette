import { consumeRuntimeMessages } from "@cbj/vignette-core";
import { sseRuntimeSource } from "@cbj/vignette-target-obs";
import process from "node:process";

import { createStudioObsRuntime } from "./studio-obs.js";

const runtimeUrl = process.env.VIGNETTE_RUNTIME_URL ?? "http://127.0.0.1:4173/runtime";
const reportError = (error: Error): void => {
  console.error(error.stack ?? error.message);
};
const runtime = createStudioObsRuntime({
  url: process.env.VIGNETTE_OBS_URL ?? "ws://127.0.0.1:4455",
  ...(process.env.VIGNETTE_ASSET_ORIGIN === undefined
    ? {}
    : { assetOrigin: process.env.VIGNETTE_ASSET_ORIGIN }),
  ...(process.env.VIGNETTE_OBS_PASSWORD === undefined
    ? {}
    : { password: process.env.VIGNETTE_OBS_PASSWORD }),
  onError: reportError,
});
const controller = new AbortController();
const shutdown = (): void => {
  controller.abort();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

console.log(`Vignette worker consuming ${runtimeUrl}`);
try {
  await consumeRuntimeMessages(
    runtime,
    sseRuntimeSource(runtimeUrl, { onError: reportError })(controller.signal),
  );
} finally {
  await runtime.dispose();
}
