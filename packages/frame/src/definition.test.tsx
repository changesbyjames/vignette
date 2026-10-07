import { z } from "zod";
import type { BrowserSource } from "@strangecyan/vignette-core";
import { Broadcast, Scene, createComposerRoot } from "@strangecyan/vignette";
import { describe, expect, it } from "vitest";

import { frame } from "./definition.js";
import { createSceneStore, SceneProvider } from "./scene.js";
import { View } from "./view.js";

interface GreetingParams {
  name: string;
}

interface ObjectSchemaResult<Params extends object> {
  parse(input: Parameters<z.ZodType<Params>["parse"]>[0]): Params;
}

describe("frame View", () => {
  it("accepts supported metadata without a build transform", () => {
    const metadata = {
      routeKey: "greeting-manual",
      moduleUrl: "/frames/greeting.js",
      exportName: "greeting",
    };
    const greeting = frame({
      metadata,
      params: z.object({}).loose(),
      view: () => <div />,
    });

    expect(greeting.metadata).toEqual(metadata);
  });

  it("validates params and lowers to an ordinary browser source snapshot", async () => {
    const greeting = frame.withMetadata({
      routeKey: "greeting-abc123",
      moduleUrl: "/src/greeting.frame.tsx",
      exportName: "greeting",
    })({
      params: objectSchema<GreetingParams>((input) => {
        return z.object({ name: z.string({ error: "name required" }) }).parse(input);
      }),
      view: ({ name }) => <div>Hello {name}!</div>,
    });
    const root = createComposerRoot({
      projectId: "frame-test",
      canvas: { width: 1920, height: 1080 },
    });

    await root.render(
      <SceneProvider scene={createSceneStore({ origin: "http://127.0.0.1:4173" })}>
        <Broadcast>
          <Scene id="main">
            <View
              source={greeting}
              params={{ name: "James" }}
              style={{ width: 640, height: 360 }}
            />
          </Scene>
        </Broadcast>
      </SceneProvider>,
    );

    const snapshot = root.snapshot;
    const definition = snapshot?.sources[0]?.definition;
    expect(definition?.kind).toBe("source:browser");
    if (definition?.kind !== "source:browser") return;
    const browserDefinition =
      /* SAFETY: This fixture or kind-selected source factory supplies the complete built-in definition inspected here. */ definition as BrowserSource;
    expect(browserDefinition.url).toContain("/__vignette/frame/greeting-abc123?props=");
    expect(new URL(browserDefinition.url).searchParams.get("props")).toBe('{"name":"James"}');
    expect(snapshot?.scenes[0]?.items[0]?.content).toEqual({
      kind: "source",
      sourceId: browserDefinition.id,
    });
    await root.dispose();
  });

  it("rejects invalid params at the authoring boundary", async () => {
    const greeting = frame.withMetadata({
      routeKey: "greeting-abc123",
      moduleUrl: "/src/greeting.frame.tsx",
      exportName: "greeting",
    })({
      params: objectSchema<GreetingParams>((input) => {
        return z.object({ name: z.string({ error: "name required" }) }).parse(input);
      }),
      view: ({ name }) => <div>{name}</div>,
    });
    const root = createComposerRoot({
      projectId: "frame-test",
      canvas: { width: 1920, height: 1080 },
    });

    await expect(
      root.render(
        <SceneProvider scene={createSceneStore({ origin: "http://127.0.0.1:4173" })}>
          <Broadcast>
            <Scene id="main">
              {/* @ts-expect-error Deliberately exercise runtime validation for untyped input. */}
              <View source={greeting} params={{}} />
            </Scene>
          </Broadcast>
        </SceneProvider>,
      ),
    ).rejects.toThrow(/name required/u);
    await root.dispose();
  });

  it("reactively updates frame origins through the scene store", async () => {
    const greeting = frame.withMetadata({
      routeKey: "origin-test",
      moduleUrl: "/src/origin.frame.tsx",
      exportName: "greeting",
    })({ params: PassthroughSchema, view: () => <div /> });
    const scene = createSceneStore({ origin: "http://localhost:4173" });
    const root = createComposerRoot({
      projectId: "origin-test",
      canvas: { width: 1920, height: 1080 },
    });
    await root.render(
      <SceneProvider scene={scene}>
        <Broadcast>
          <Scene id="main">
            <View source={greeting} params={{}} style={{ width: 640, height: 360 }} />
          </Scene>
        </Broadcast>
      </SceneProvider>,
    );

    scene.set({ origin: "https://example.com" });
    const snapshot = await root.settled();
    const definition = snapshot.sources[0]?.definition;
    expect(definition?.kind).toBe("source:browser");
    if (definition?.kind !== "source:browser") return;
    expect(
      /* SAFETY: This fixture or kind-selected source factory supplies the complete built-in definition inspected here. */ (
        definition as BrowserSource
      ).url,
    ).toMatch(/^https:\/\/example\.com\//u);
    await root.dispose();
  });
});

const PassthroughSchema = z.object({}).loose();
export type Passthrough = z.output<typeof PassthroughSchema>;

function objectSchema<Params extends object>(
  parse: (input: Parameters<z.ZodType<Params>["parse"]>[0]) => Params,
): ObjectSchemaResult<Params> {
  return { parse };
}
