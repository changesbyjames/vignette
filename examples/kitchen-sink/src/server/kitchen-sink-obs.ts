import { moqObsCodec } from "@strangecyan/vignette-moq/obs";
import { OBSRuntime } from "@strangecyan/vignette-target-obs";

export interface KitchenSinkObsRuntimeOptions {
  /** The composition's `id`; the runtime refuses a stream for any other project. */
  readonly projectId: string;
  readonly url?: string | undefined;
  readonly password?: string | undefined;
  /** How this process reaches the composer; resolves root-relative asset and frame URLs. */
  readonly baseUrl: string;
  /** How OBS reaches the composer when it differs from `baseUrl` (e.g. a Docker worker). */
  readonly browserSourceBaseUrl?: string | undefined;
  readonly onError: (error: Error) => void;
}

export function createKitchenSinkObsRuntime(options: KitchenSinkObsRuntimeOptions): OBSRuntime {
  return new OBSRuntime({
    projectId: options.projectId,
    url: options.url ?? "ws://127.0.0.1:4455",
    extensions: [moqObsCodec],
    baseUrl: options.baseUrl,
    browserSourceBaseUrl: options.browserSourceBaseUrl,
    password: options.password,
    onError: options.onError,
  });
}
