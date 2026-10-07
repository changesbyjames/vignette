import { omitUndefined } from "@strangecyan/vignette-core";
import { consumeRuntimeMessages } from "@strangecyan/vignette-core";
import {
  OBSRuntime,
  sseRuntimeSource,
  type ObsSourceCodec,
} from "@strangecyan/vignette-target-obs";

import type { ObsCommandOptions } from "./cli-options.js";

export async function runObs(
  options: ObsCommandOptions,
  extensions: readonly ObsSourceCodec[],
  signal: AbortSignal,
  onError: (error: Error) => void,
): Promise<void> {
  const runtime = new OBSRuntime({
    projectId: options.project,
    url: options.obsUrl,
    baseUrl: options.url,
    extensions,
    onError,
    ...omitUndefined({ password: options.password }),
    ...omitUndefined({ browserSourceBaseUrl: options.browserSourceBaseUrl }),
  });
  try {
    await consumeRuntimeMessages(runtime, sseRuntimeSource(options.url, { onError })(signal));
  } finally {
    await runtime.dispose();
  }
}
