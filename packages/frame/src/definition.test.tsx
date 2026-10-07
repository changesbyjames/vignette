import { z } from "zod";
import type { BrowserSource } from "@strangecyan/vignette-core";
import { Broadcast, Scene, createComposerRoot, defineComposition } from "@strangecyan/vignette";
import { describe, expect, it } from "vitest";

import { frame } from "./definition.js";
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
    const root = createComposerRoot(
      defineComposition({
        id: "frame-test",
        canvas: { width: 1920, height: 1080 },
        component: () => (
          <Broadcast>
            <Scene id="main">
              <View
                source={greeting}
                params={{ name: "James" }}
                style={{ width: 640, height: 360 }}
              />
            </Scene>
          </Broadcast>
        ),
      }),
    );

    await root.render();

    const snapshot = root.snapshot;
    const definition = snapshot?.sources[0]?.definition;
    expect(definition?.kind).toBe("source:browser");
    if (definition?.kind !== "source:browser") return;
    const browserDefinition =
      /* SAFETY: This fixture or kind-selected source factory supplies the complete built-in definition inspected here. */ definition as BrowserSource;
    expect(browserDefinition.url).toMatch(/^\/__vignette\/frame\/greeting-abc123\?props=/u);
    expect(
      new URL(browserDefinition.url, "http://composer.invalid").searchParams.get("props"),
    ).toBe('{"name":"James"}');
    expect(snapshot?.scenes[0]?.items[0]?.content).toEqual({
      kind: "source",
      sourceId: browserDefinition.id,
    });
    // Without an explicit viewport, the page renders at the placement's laid-out size.
    expect(browserDefinition.viewport).toEqual({ width: 640, height: 360 });
    await root.dispose();
  });

  it("places frames without parameters without a params prop", async () => {
    const banner = frame.withMetadata({
      routeKey: "banner-abc123",
      moduleUrl: "/src/banner.frame.tsx",
      exportName: "banner",
    })({ view: () => <div>Live</div> });
    const root = createComposerRoot(
      defineComposition({
        id: "frame-test",
        canvas: { width: 1920, height: 1080 },
        component: () => (
          <Broadcast>
            <Scene id="main">
              <View source={banner} style={{ width: 800, height: 120 }} />
            </Scene>
          </Broadcast>
        ),
      }),
    );

    const { snapshot } = await root.render();

    const definition =
      /* SAFETY: The only source in this composition is the frame's browser source. */ snapshot
        .sources[0]?.definition as BrowserSource | undefined;
    expect(
      new URL(definition?.url ?? "", "http://composer.invalid").searchParams.get("props"),
    ).toBe("{}");
    expect(banner.params.parse({})).toEqual({});
    expect(() => banner.params.parse({ unexpected: true })).toThrow();
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
    const root = createComposerRoot(
      defineComposition({
        id: "frame-test",
        canvas: { width: 1920, height: 1080 },
        component: () => (
          <Broadcast>
            <Scene id="main">
              {/* @ts-expect-error Deliberately exercise runtime validation for untyped input. */}
              <View source={greeting} params={{}} />
              {/* @ts-expect-error Frames with required parameters require `params`. */}
              <View id="missing" source={greeting} />
            </Scene>
          </Broadcast>
        ),
      }),
    );

    await expect(root.render()).rejects.toThrow(/name required/u);
    await root.dispose();
  });
});

function objectSchema<Params extends object>(
  parse: (input: Parameters<z.ZodType<Params>["parse"]>[0]) => Params,
): ObjectSchemaResult<Params> {
  return { parse };
}
