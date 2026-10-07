import { omitUndefined } from "@strangecyan/vignette-core";
import { moqObsCodec } from "@strangecyan/vignette-moq/obs";
import { OBSRuntime } from "@strangecyan/vignette-target-obs";

import { KITCHEN_SINK_PROJECT_ID } from "./kitchen-sink.js";

export interface KitchenSinkObsRuntimeOptions {
  readonly url?: string;
  readonly password?: string;
  /** How this process reaches the composer; resolves root-relative asset and frame URLs. */
  readonly baseUrl: string;
  /** How OBS reaches the composer when it differs from `baseUrl` (e.g. a Docker worker). */
  readonly browserSourceBaseUrl?: string;
  readonly onError: (error: Error) => void;
}

export function createKitchenSinkObsRuntime(options: KitchenSinkObsRuntimeOptions): OBSRuntime {
  return new OBSRuntime({
    projectId: KITCHEN_SINK_PROJECT_ID,
    url: options.url ?? "ws://127.0.0.1:4455",
    extensions: [moqObsCodec],
    baseUrl: options.baseUrl,
    ...omitUndefined({ browserSourceBaseUrl: options.browserSourceBaseUrl }),
    ...omitUndefined({ password: options.password }),
    onError: options.onError,
  });
}
