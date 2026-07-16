import { moqObsCodec } from "@cbj/vignette-moq/obs";
import { OBSRuntime } from "@cbj/vignette-target-obs";

import { STUDIO_PROJECT_ID } from "./studio.js";

export interface StudioObsRuntimeOptions {
  readonly url?: string;
  readonly password?: string;
  /** Internal origin used only when the worker downloads manifest assets. */
  readonly assetOrigin?: string;
  readonly onError: (error: Error) => void;
}

export function createStudioObsRuntime(options: StudioObsRuntimeOptions): OBSRuntime {
  const assetOrigin = options.assetOrigin;
  return new OBSRuntime({
    projectId: STUDIO_PROJECT_ID,
    url: options.url ?? "ws://127.0.0.1:4455",
    extensions: [moqObsCodec],
    ...(options.password === undefined ? {} : { password: options.password }),
    ...(assetOrigin === undefined
      ? {}
      : { fetch: (url: string) => fetch(rewriteAssetOrigin(url, assetOrigin)) }),
    onError: options.onError,
  });
}

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
