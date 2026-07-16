import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { frame, type FrameMetadata } from "./definition.js";
import {
  createFrameRequestHandler,
  FrameRouteRegistry,
  type ModuleHost,
  type NodeRequestHandler,
} from "./server.js";

const metadata: FrameMetadata = {
  routeKey: "greeting-test",
  moduleUrl: "/frames/greeting.js",
  exportName: "greeting",
};

const greeting = frame.__withMetadata(metadata)({
  params: {
    parse(input: unknown): { name: string } {
      if (
        typeof input !== "object" ||
        input === null ||
        typeof (input as { name?: unknown }).name !== "string"
      ) {
        throw new Error("name must be a string");
      }
      return { name: (input as { name: string }).name };
    },
  },
  view: ({ name }) => createElement("strong", null, `Hello ${name}`),
});

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error === undefined) resolve();
            else reject(error);
          });
        }),
    ),
  );
});

describe("frame request handler", () => {
  it("renders frame HTML with serialized props", async () => {
    const response = await request(
      createHandler({ greeting }),
      "/__react-obs/frame/greeting-test?props=%7B%22name%22%3A%22Ada%22%7D",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.text).toContain("<strong>Hello Ada</strong>");
    expect(response.text).toContain('{"name":"Ada"}');
    expect(response.text).toContain('src="/__react-obs/frame/greeting-test/hydrate.js"');
  });

  it("uses host-resolved hydration module URLs", async () => {
    const response = await request(
      createHandler({ greeting }),
      "/__react-obs/frame/greeting-test/hydrate.js",
    );

    expect(response.status).toBe(200);
    expect(response.text).toContain('from "https://assets.test/frames/greeting.js"');
    expect(response.text).toContain('from "https://assets.test/frame-client.js"');
    expect(response.text).not.toContain("/@fs/");
  });

  it("maps props validation failures to 400", async () => {
    const response = await request(
      createHandler({ greeting }),
      "/__react-obs/frame/greeting-test?props=%7B%22name%22%3A1%7D",
    );

    expect(response.status).toBe(400);
    expect(response.text).toBe("Frame props failed validation: name must be a string");
  });

  it("maps unknown frame routes to 404", async () => {
    const response = await request(
      createHandler({ greeting }),
      "/__react-obs/frame/unknown?props=%7B%7D",
    );

    expect(response.status).toBe(404);
    expect(response.text).toBe("Frame route not found.");
  });

  it("leaves unrelated paths unhandled", async () => {
    const response = await request(createHandler({ greeting }), "/health");

    expect(response.status).toBe(404);
    expect(response.text).toBe("Not handled.");
  });

  it("serves registered definitions without any module loading", async () => {
    const registry = new FrameRouteRegistry();
    registry.registerDefinition(greeting);
    const handler = createFrameRequestHandler(
      {
        resolveClientModule: (moduleUrl) => `https://assets.test${moduleUrl}`,
        resolveClientHelper: () => "https://assets.test/frame-client.js",
      },
      registry,
    );

    const response = await request(
      handler,
      "/__react-obs/frame/greeting-test?props=%7B%22name%22%3A%22Ada%22%7D",
    );

    expect(response.status).toBe(200);
    expect(response.text).toContain("<strong>Hello Ada</strong>");
  });

  it("reports metadata-only routes deterministically when the host cannot load modules", async () => {
    const registry = new FrameRouteRegistry();
    registry.registerFromTransform(metadata);
    const handler = createFrameRequestHandler(
      {
        resolveClientModule: (moduleUrl) => moduleUrl,
        resolveClientHelper: () => "/frame-client.js",
      },
      registry,
    );

    const response = await request(
      handler,
      "/__react-obs/frame/greeting-test?props=%7B%22name%22%3A%22Ada%22%7D",
    );

    expect(response.status).toBe(500);
    expect(response.text).toBe(
      "Frame route 'greeting-test' has no rendered definition and this host cannot load modules.",
    );
  });
});

describe("FrameRouteRegistry", () => {
  it("rejects definitions without transform metadata", () => {
    const registry = new FrameRouteRegistry();
    const plain = frame({ params: passthroughParams, view: EmptyView });

    expect(() => {
      registry.registerDefinition(plain);
    }).toThrow("Frame definition has no client metadata.");
  });

  it("rejects colliding route keys from different modules", () => {
    const registry = new FrameRouteRegistry();
    registry.registerDefinition(greeting);

    expect(() => {
      registry.registerFromTransform({ ...metadata, moduleUrl: "/frames/other.js" });
    }).toThrow("Frame route collision for 'greeting-test'.");
  });

  it("keeps the live definition when the transform re-registers the same route", () => {
    const registry = new FrameRouteRegistry();
    registry.registerDefinition(greeting);
    registry.registerFromTransform(metadata);

    expect(registry.get(metadata.routeKey)?.definition).toBe(greeting);
    expect(registry.get(metadata.routeKey)?.metadata).toEqual(metadata);
  });
});

const passthroughParams = { parse: (input: unknown) => input as object };

function EmptyView(): ReturnType<typeof createElement> {
  return createElement("div");
}

function createHandler(exports: Record<string, unknown>): NodeRequestHandler {
  const registry = new FrameRouteRegistry();
  registry.registerFromTransform(metadata);
  return createFrameRequestHandler(
    createHost(() => Promise.resolve(exports)),
    registry,
  );
}

function createHost(loadModule: NonNullable<ModuleHost["loadModule"]>): ModuleHost {
  return {
    loadModule,
    resolveClientModule: (moduleUrl) => `https://assets.test${moduleUrl}`,
    resolveClientHelper: () => "https://assets.test/frame-client.js",
  };
}

async function request(
  handler: NodeRequestHandler,
  path: string,
): Promise<{ readonly status: number; readonly headers: Headers; readonly text: string }> {
  const server = createServer((incoming, outgoing) => {
    void handleNodeRequest(handler, incoming, outgoing);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${String(address.port)}${path}`);
  return { status: response.status, headers: response.headers, text: await response.text() };
}

async function handleNodeRequest(
  handler: NodeRequestHandler,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (!(await handler(request, response))) {
    response.statusCode = 404;
    response.end("Not handled.");
  }
}
