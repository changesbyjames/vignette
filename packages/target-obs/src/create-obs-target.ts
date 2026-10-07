import {
  omitUndefined,
  requireBaseUrl,
  type AssetResolver,
  type RenderTarget,
} from "@strangecyan/vignette-core";

import type { ObsSourceCodec } from "./codecs/index.js";
import { ObsWebSocketTransport } from "./obs-websocket-transport.js";
import {
  ObsConvergenceScheduler,
  type ObsRetryOptions,
  type ObsSchedulerRuntime,
} from "./scheduler.js";
import type { ObsTransport } from "./transport.js";

/** Connection and dependency options for a directly published OBS target. */
export interface CreateObsTargetOptions {
  readonly id?: string | undefined;
  readonly url?: string | undefined;
  readonly password?: string | undefined;
  readonly projectId: string;
  readonly assetResolver: AssetResolver;
  /**
   * Absolute HTTP(S) base OBS uses for root-relative URLs it loads itself (browser sources).
   * Without it, a snapshot with a root-relative browser source URL fails preflight.
   */
  readonly browserSourceBaseUrl?: string | undefined;
  readonly retry?: ObsRetryOptions | undefined;
  readonly extensions?: readonly ObsSourceCodec[] | undefined;
  readonly onError?: ((error: Error) => void) | undefined;
}

/** Creates an OBS render target backed by the production WebSocket transport. */
export function createObsTarget(options: CreateObsTargetOptions): RenderTarget {
  return createObsScheduler(options, new ObsWebSocketTransport());
}

/** Injection seam that keeps the concrete websocket client out of required tests. */
export function createObsTargetWithTransport(
  options: CreateObsTargetOptions,
  transport: ObsTransport,
  runtime?: ObsSchedulerRuntime,
): RenderTarget {
  return createObsScheduler(options, transport, runtime);
}

export function createObsScheduler(
  options: CreateObsTargetOptions,
  transport: ObsTransport,
  runtime?: ObsSchedulerRuntime,
): ObsConvergenceScheduler {
  return new ObsConvergenceScheduler(
    omitUndefined({
      id: options.id ?? "obs",
      url: options.url ?? "ws://127.0.0.1:4455",
      password: options.password,
      projectId: options.projectId,
      assetResolver: options.assetResolver,
      browserSourceBaseUrl:
        options.browserSourceBaseUrl === undefined
          ? undefined
          : requireBaseUrl(options.browserSourceBaseUrl, "browserSourceBaseUrl"),
      retry: options.retry,
      extensions: options.extensions,
      onError: options.onError,
      transport,
      runtime,
    }),
  );
}

export type { ObsRetryOptions, ObsSchedulerRuntime } from "./scheduler.js";
