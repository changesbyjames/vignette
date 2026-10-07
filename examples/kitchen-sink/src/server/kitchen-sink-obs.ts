import { omitUndefined } from "@strangecyan/vignette-core";
import { moqObsCodec } from "@strangecyan/vignette-moq/obs";
import { OBSRuntime } from "@strangecyan/vignette-target-obs";

import { KITCHEN_SINK_PROJECT_ID } from "./kitchen-sink.js";

export interface KitchenSinkObsRuntimeOptions {
  readonly url?: string;
  readonly password?: string;
  /** Internal origin used only when the worker downloads manifest assets. */
  readonly assetOrigin?: string;
  readonly onError: (error: Error) => void;
}

export function createKitchenSinkObsRuntime(options: KitchenSinkObsRuntimeOptions): OBSRuntime {
  const assetOrigin = options.assetOrigin;
  return new OBSRuntime({
    projectId: KITCHEN_SINK_PROJECT_ID,
    url: options.url ?? "ws://127.0.0.1:4455",
    extensions: [moqObsCodec],
    ...omitUndefined({ password: options.password }),
    ...omitUndefined({
      fetch:
        assetOrigin === undefined
          ? undefined
          : (url: string) => fetch(rewriteAssetOrigin(url, assetOrigin)),
    }),
    onError: options.onError,
  });
}

/** Accept a bare HTTP origin and preserve the asset path, query, and fragment when rewriting its host. */
export function rewriteAssetOrigin(url: string, origin: string): string {
  const source = new URL(url);
  const target = new URL(origin);
  if (
    (target.protocol !== "http:" && target.protocol !== "https:") ||
    target.pathname !== "/" ||
    target.search !== "" ||
    target.hash !== ""
  ) {
    throw new Error("VIGNETTE_ASSET_ORIGIN must be an HTTP(S) origin without a path.");
  }
  target.pathname = source.pathname;
  target.search = source.search;
  return target.href;
}
