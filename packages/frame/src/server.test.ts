import { z } from "zod";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { frame, type FrameMetadata } from "./definition.js";
import { useRemoteStore } from "./remote-store-client.js";
import { defineRemoteStore } from "./remote-store.js";
import type { BrowserPageProps, BrowserSource, CompiledSnapshot } from "@strangecyan/vignette-core";

import {
  createFrameRequestHandler,
  FrameRouteRegistry,
  renderFrameHtml,
  resolveFrame,
  type FrameRequestHandler,
  type FrameModuleHost,
  type FrameServerOptions,
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
  it("server-renders a placement with its current props and mounts it from the stream", async () => {
    const snapshot = snapshotWith("lower-third", { name: "Ada" });
    const response = await request(
      createHandler({ stream: "/live", snapshot: () => snapshot }),
      "/__vignette/frame/greeting-test/lower-third",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.text).toContain("<strong>Hello Ada</strong>");
    expect(response.text).toContain('from "https://assets.test/frames/greeting.js"');
    expect(response.text).toContain(
      'import { mountFrame } from "https://assets.test/frame-client.js"',
    );
    expect(response.text).toContain(
      'mountFrame(frameModule["greeting"], {"sourceId":"lower-third","stream":"/live","initialProps":{"name":"Ada"}});',
    );
    expect(response.text).not.toContain("hydrate.js");
  });

  it("renders an empty page that waits for the stream when no snapshot holds the placement", async () => {
    const response = await request(createHandler(), "/__vignette/frame/greeting-test/elsewhere");

    expect(response.status).toBe(200);
    expect(response.text).toContain("<div data-vignette-frame-root></div>");
    expect(response.text).toContain('{"sourceId":"elsewhere","stream":"/stream"}');
  });

  it("keeps embedded props from closing the inline script", async () => {
    const snapshot = snapshotWith("lower-third", { name: "</script><script>alert(1)</script>" });
    const response = await request(
      createHandler({ snapshot: () => snapshot }),
      "/__vignette/frame/greeting-test/lower-third",
    );

    const script = /<script type="module">([\s\S]*)<\/script>/u.exec(response.text)?.[1];
    expect(script).not.toContain("</script>");
    expect(script).toContain("\\u003c/script>");
  });

  it("reports props that no longer match the frame's schema as a server error", async () => {
    const snapshot = snapshotWith("lower-third", { name: 1 });
    const response = await request(
      createHandler({ snapshot: () => snapshot }),
      "/__vignette/frame/greeting-test/lower-third",
    );

    expect(response.status).toBe(500);
    expect(response.text).toBe("Frame props failed validation: name must be a string");
  });

  it("maps unknown frames and malformed placements to 404", async () => {
    const handler = createHandler();
    for (const path of [
      "/__vignette/frame/unknown/lower-third",
      "/__vignette/frame/greeting-test",
      "/__vignette/frame/greeting-test/",
      "/__vignette/frame/greeting-test/lower-third/hydrate.js",
    ]) {
      const response = await request(handler, path);
      expect(response.status, path).toBe(404);
      expect(response.text).toBe("Frame route not found.");
    }
  });

  it("leaves unrelated paths unhandled", async () => {
    const response = await request(createHandler(), "/health");

    expect(response.status).toBe(404);
    expect(response.text).toBe("Not handled.");
  });

  it("resolves request targets to plain results without Fetch objects", () => {
    const registry = new FrameRouteRegistry();
    registry.registerDefinition(greeting);
    const frames = { modules: createHost(), registry };

    const page = resolveFrame(frames, "/__vignette/frame/greeting-test/lower-third?ignored=1");
    expect(page?.status).toBe(200);
    expect(page?.headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(resolveFrame(frames, "/health")).toBeUndefined();
  });

  it("exports the pure page renderer for platform routers", () => {
    const html = renderFrameHtml(greeting, metadata, {
      sourceId: "lower-third",
      stream: "/stream",
      modules: createHost(),
      props: { name: "Ada" },
    });

    expect(html).toContain("<strong>Hello Ada</strong>");
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

    const html = renderFrameHtml(live, liveMetadata, {
      sourceId: "live",
      stream: "/stream",
      modules: createHost(),
      props: {},
    });

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

    expect(registry.get(metadata.routeKey)?.metadata).toEqual(metadata);
  });
});

const PassthroughParamsSchema = z.object({}).loose();
export type PassthroughParams = z.output<typeof PassthroughParamsSchema>;

function EmptyView(): ReturnType<typeof createElement> {
  return createElement("div");
}

function createHandler(options: FrameServerOptions = {}): FrameRequestHandler {
  const registry = new FrameRouteRegistry();
  registry.registerDefinition(greeting);
  return createFrameRequestHandler({ modules: createHost(), registry }, options);
}

/** A snapshot holding one browser source with the given page props. */
function snapshotWith(sourceId: string, props: BrowserPageProps): CompiledSnapshot {
  const definition: BrowserSource = {
    kind: "source:browser",
    id: sourceId,
    url: `/__vignette/frame/greeting-test/${sourceId}`,
    props,
  };
  return {
    revision: 1,
    projectId: "frames",
    canvas: { width: 1920, height: 1080 },
    sources: [{ id: sourceId, definition }],
    scenes: [],
    warnings: [],
  };
}

function createHost(): FrameModuleHost {
  return {
    resolveClientModule: (moduleUrl) => `https://assets.test${moduleUrl}`,
    resolveClientHelper: () => "https://assets.test/frame-client.js",
  };
}

async function request(handler: FrameRequestHandler, path: string): Promise<FrameResponse> {
  const response =
    handler(new Request(`https://vignette.test${path}`)) ??
    new Response("Not handled.", { status: 404 });
  return { status: response.status, headers: response.headers, text: await response.text() };
}
