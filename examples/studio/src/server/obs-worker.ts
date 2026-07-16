import { consumeRuntimeMessages } from "@cbj/react-obs-core";
import { sseRuntimeSource } from "@cbj/react-obs-target-obs";
import process from "node:process";

import { createStudioObsRuntime } from "./studio-obs.js";

const runtimeUrl = process.env.REACT_OBS_RUNTIME_URL ?? "http://127.0.0.1:4173/runtime";
const reportError = (error: Error): void => {
  console.error(error.stack ?? error.message);
};
const runtime = createStudioObsRuntime({
  url: process.env.REACT_OBS_URL ?? "ws://127.0.0.1:4455",
  ...(process.env.REACT_OBS_ASSET_ORIGIN === undefined
    ? {}
    : { assetOrigin: process.env.REACT_OBS_ASSET_ORIGIN }),
  ...(process.env.REACT_OBS_PASSWORD === undefined
    ? {}
    : { password: process.env.REACT_OBS_PASSWORD }),
  onError: reportError,
});
const controller = new AbortController();
const shutdown = (): void => {
  controller.abort();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

console.log(`React OBS worker consuming ${runtimeUrl}`);
try {
  await consumeRuntimeMessages(
    runtime,
    sseRuntimeSource(runtimeUrl, { onError: reportError })(controller.signal),
  );
} finally {
  await runtime.dispose();
}
