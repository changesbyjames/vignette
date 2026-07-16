/** Node HTTP adapter for the platform-neutral composer host. */
import type { IncomingMessage, ServerResponse } from "node:http";

import type { ComposerHost } from "./index.js";

export type NodeRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<boolean>;

/** Adapts a composer host's Fetch API handler to Node HTTP. */
export function createNodeRequestHandler(host: ComposerHost): NodeRequestHandler {
  return async (request, response) => {
    if (request.url === undefined) return false;
    const abort = new AbortController();
    response.once("close", () => {
      abort.abort();
    });
    const result = await host.handleRequest(
      new Request(new URL(request.url, "http://vignette.local"), { signal: abort.signal }),
    );
    if (result === undefined) return false;
    response.statusCode = result.status;
    result.headers.forEach((value, name) => {
      response.setHeader(name, value);
    });
    if (result.body !== null) {
      for await (const chunk of result.body) response.write(chunk);
    }
    if (!response.writableEnded) response.end();
    return true;
  };
}
