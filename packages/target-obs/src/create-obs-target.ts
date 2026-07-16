import {
  omitUndefined,
  type AssetResolver,
  type ProjectId,
  type RenderTarget,
} from "@cbj/vignette-core";

import type { ObsSourceCodec } from "./codecs/index.js";
import { ObsWebSocketTransport } from "./obs-websocket-transport.js";
import {
  ObsConvergenceScheduler,
  type ObsRetryOptions,
  type ObsSchedulerRuntime,
} from "./scheduler.js";
import type { ObsTransport } from "./transport.js";

export interface CreateObsTargetOptions {
  readonly id?: string;
  readonly url?: string;
  readonly password?: string;
  readonly projectId: ProjectId;
  readonly assetResolver: AssetResolver;
  readonly retry?: ObsRetryOptions;
  readonly extensions?: readonly ObsSourceCodec[];
  readonly onError?: (error: Error) => void;
}

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
      retry: options.retry,
      extensions: options.extensions,
      onError: options.onError,
      transport,
      runtime,
    }),
  );
}

export type { ObsRetryOptions, ObsSchedulerRuntime } from "./scheduler.js";
