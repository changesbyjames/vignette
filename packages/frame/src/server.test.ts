import { z } from "zod";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { frame, type FrameMetadata } from "./definition.js";
import { useRemoteStore } from "./remote-store-client.js";
import { defineRemoteStore } from "./remote-store.js";
import {
  createFrameRequestHandler,
  FrameRouteRegistry,
  renderFrameHtml,
  renderHydrationModule,
  type FrameRequestHandler,
  type FrameModuleHost,
} from "./server.js";

interface FrameResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

const metadata: FrameMetadata = {
  routeKey: "greeting-test",
  moduleUrl: "/frames/greeting.js",
  exportName: "greeting",
};

interface GreetingParams {
  name: string;
}

interface LiveStoreContext {
  readonly title: string;
}

interface LiveStoreSnapshot {
  readonly context: LiveStoreContext;
}

interface LiveStore {
  getSnapshot(): LiveStoreSnapshot;
}

const greeting = frame.withMetadata(metadata)({
  params: {
    parse(input: Parameters<z.ZodType<GreetingParams>["parse"]>[0]): GreetingParams {
      const result = z.object({ name: z.string() }).safeParse(input);
      if (!result.success) throw new Error("name must be a string");
      return result.data;
    },
  },
  view: ({ name }) => createElement("strong", null, `Hello ${name}`),
});

describe("frame request handler", () => {
  it("renders frame HTML with serialized props", async () => {
    const response = await request(
      createHandler(),
      "/__vignette/frame/greeting-test?props=%7B%22name%22%3A%22Ada%22%7D",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.text).toContain("<strong>Hello Ada</strong>");
    expect(response.text).toContain('{"name":"Ada"}');
    expect(response.text).toContain('src="/__vignette/frame/greeting-test/hydrate.js"');
  });

  it("uses host-resolved hydration module URLs", async () => {
    const response = await request(createHandler(), "/__vignette/frame/greeting-test/hydrate.js");

    expect(response.status).toBe(200);
    expect(response.text).toContain('from "https://assets.test/frames/greeting.js"');
    expect(response.text).toContain('from "https://assets.test/frame-client.js"');
    expect(response.text).not.toContain("/@fs/");
  });

  it("maps props validation failures to 400", async () => {
    const response = await request(
      createHandler(),
      "/__vignette/frame/greeting-test?props=%7B%22name%22%3A1%7D",
    );

    expect(response.status).toBe(400);
    expect(response.text).toBe("Frame props failed validation: name must be a string");
  });

  it("maps unknown frame routes to 404", async () => {
    const response = await request(createHandler(), "/__vignette/frame/unknown?props=%7B%7D");

    expect(response.status).toBe(404);
    expect(response.text).toBe("Frame route not found.");
  });

  it("leaves unrelated paths unhandled", async () => {
    const response = await request(createHandler(), "/health");

    expect(response.status).toBe(404);
    expect(response.text).toBe("Not handled.");
  });

  it("serves registered definitions without any module loading", async () => {
    const registry = new FrameRouteRegistry();
    registry.registerDefinition(greeting);
    const handler = createFrameRequestHandler({
      modules: {
        resolveClientModule: (moduleUrl) => `https://assets.test${moduleUrl}`,
        resolveClientHelper: () => "https://assets.test/frame-client.js",
      },
      registry,
    });

    const response = await request(
      handler,
      "/__vignette/frame/greeting-test?props=%7B%22name%22%3A%22Ada%22%7D",
    );

    expect(response.status).toBe(200);
    expect(response.text).toContain("<strong>Hello Ada</strong>");
  });

  it("exports pure render kernels for platform routers", () => {
    expect(renderFrameHtml(greeting, metadata, { name: "Ada" })).toContain(
      "<strong>Hello Ada</strong>",
    );
    expect(renderHydrationModule(createHost(), metadata)).toContain(
      'from "https://assets.test/frames/greeting.js"',
    );
  });

  it("renders views that suspend on the server without their own Suspense boundary", () => {
    const liveStore = defineRemoteStore<LiveStore>({ id: "live" });
    const liveMetadata: FrameMetadata = { ...metadata, routeKey: "live-test", exportName: "live" };
    const live = frame.withMetadata(liveMetadata)({
      view: () =>
        createElement(
          "em",
          null,
          useRemoteStore(liveStore, (state) => state.context.title),
        ),
    });

    const html = renderFrameHtml(live, liveMetadata, {});

    expect(html).toContain("<div data-vignette-frame-root>");
    expect(html).not.toContain("<em>");
  });
});

describe("FrameRouteRegistry", () => {
  it("rejects definitions without transform metadata", () => {
    const registry = new FrameRouteRegistry();
    const plain = frame({ params: PassthroughParamsSchema, view: EmptyView });

    expect(() => {
      registry.registerDefinition(plain);
    }).toThrow("Frame definition has no client metadata.");
  });

  it("rejects colliding route keys from different modules", () => {
    const registry = new FrameRouteRegistry();
    registry.registerDefinition(greeting);

    expect(() => {
      registry.registerDefinition(
        frame.withMetadata({ ...metadata, moduleUrl: "/frames/other.js" })({
          params: PassthroughParamsSchema,
          view: EmptyView,
        }),
      );
    }).toThrow("Frame route collision for 'greeting-test'.");
  });

  it("allows idempotent registration of the same definition", () => {
    const registry = new FrameRouteRegistry();
    registry.registerDefinition(greeting);
    registry.registerDefinition(greeting);

    expect(registry.get(metadata.routeKey)?.definition).toBe(greeting);
    expect(registry.get(metadata.routeKey)?.metadata).toEqual(metadata);
  });
});

const PassthroughParamsSchema = z.object({}).loose();
export type PassthroughParams = z.output<typeof PassthroughParamsSchema>;

function EmptyView(): ReturnType<typeof createElement> {
  return createElement("div");
}

function createHandler(): FrameRequestHandler {
  const registry = new FrameRouteRegistry();
  registry.registerDefinition(greeting);
  return createFrameRequestHandler({
    modules: createHost(),
    registry,
  });
}

function createHost(): FrameModuleHost {
  return {
    resolveClientModule: (moduleUrl) => `https://assets.test${moduleUrl}`,
    resolveClientHelper: () => "https://assets.test/frame-client.js",
  };
}

async function request(handler: FrameRequestHandler, path: string): Promise<FrameResponse> {
  const response =
    (await handler(new Request(`https://vignette.test${path}`))) ??
    new Response("Not handled.", { status: 404 });
  return { status: response.status, headers: response.headers, text: await response.text() };
}
