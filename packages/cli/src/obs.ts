import { omitUndefined } from "@strangecyan/vignette-core";
import { consumeStream } from "@strangecyan/vignette-core";
import { OBSRuntime, sseStream, type ObsSourceCodec } from "@strangecyan/vignette-target-obs";

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
    await consumeStream(runtime, sseStream(options.url, { onError })(signal));
  } finally {
    await runtime.dispose();
  }
}
