/** Node HTTP adapter for Fetch-based frame handlers. */
import type { IncomingMessage, ServerResponse } from "node:http";

import type { FrameRequestHandler } from "./server.js";

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
