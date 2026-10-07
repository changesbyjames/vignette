import { omitUndefined } from "@strangecyan/vignette-core";
import { consumeRuntimeMessages } from "@strangecyan/vignette-core";
import { moqObsCodec } from "@strangecyan/vignette-moq/obs";
import { OBSRuntime, sseRuntimeSource } from "@strangecyan/vignette-target-obs";

import type { ObsCommandOptions } from "./cli-options.js";

export async function runObs(
  options: ObsCommandOptions,
  signal: AbortSignal,
  onError: (error: Error) => void,
): Promise<void> {
  const runtime = new OBSRuntime({
    projectId: options.project,
    url: options.obsUrl,
    extensions: [moqObsCodec],
    onError,
    ...omitUndefined({ password: options.password }),
  });
  try {
    await consumeRuntimeMessages(runtime, sseRuntimeSource(options.url, { onError })(signal));
  } finally {
    await runtime.dispose();
  }
}
