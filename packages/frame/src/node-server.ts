/** Node HTTP adapters and filesystem-backed frame module hosting. */
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";

import {
  createClientManifestModuleHost as createModuleHostFromManifest,
  type FrameRequestHandler,
  type ModuleHost,
} from "./server.js";

/** Node HTTP handler that reports whether it consumed a request. */
export type NodeRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<boolean>;

/** Adapts a Fetch API frame handler to Node HTTP. */
export function createNodeFrameRequestHandler(handler: FrameRequestHandler): NodeRequestHandler {
  return async (request, response) => {
    if (request.url === undefined) return false;
    const result = await handler(new Request(new URL(request.url, "http://vignette.local")));
    if (result === undefined) return false;
    response.statusCode = result.status;
    result.headers.forEach((value, name) => {
      response.setHeader(name, value);
    });
    response.end(Buffer.from(await result.arrayBuffer()));
    return true;
  };
}

/** Vite client build location and hydration helper entry. */
export interface NodeClientManifestModuleHostOptions {
  readonly clientDirectory: string;
  readonly clientHelperEntry: string;
}

/** Reads a Vite client manifest from disk for the platform-neutral module host. */
export async function createClientManifestModuleHost(
  options: NodeClientManifestModuleHostOptions,
): Promise<ModuleHost> {
  const manifestPath = resolve(options.clientDirectory, ".vite/manifest.json");
  return createModuleHostFromManifest({
    manifest: JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
    clientHelperEntry: options.clientHelperEntry,
  });
}
