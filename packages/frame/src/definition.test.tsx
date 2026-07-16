import { projectId, sceneId, type BrowserSource } from "@cbj/vignette-core";
import { Broadcast, Scene, createComposerRoot } from "@cbj/vignette";
import { describe, expect, it } from "vitest";

import { frame } from "./definition.js";
import { FrameProvider, View } from "./view.js";

describe("frame View", () => {
  it("accepts supported metadata without a build transform", () => {
    const metadata = {
      routeKey: "greeting-manual",
      moduleUrl: "/frames/greeting.js",
      exportName: "greeting",
    };
    const greeting = frame({
      metadata,
      params: { parse: (input: unknown) => input as object },
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
      params: objectSchema<{ name: string }>((input) => {
        if (!isRecord(input) || typeof input.name !== "string") throw new Error("name required");
        return { name: input.name };
      }),
      view: ({ name }) => <div>Hello {name}!</div>,
    });
    const root = createComposerRoot({
      projectId: projectId("frame-test"),
      canvas: { width: 1920, height: 1080 },
    });

    await root.render(
      <FrameProvider origin="http://127.0.0.1:4173">
        <Broadcast>
          <Scene id={sceneId("main")}>
            <View
              source={greeting}
              params={{ name: "James" }}
              style={{ width: 640, height: 360 }}
            />
          </Scene>
        </Broadcast>
      </FrameProvider>,
    );

    const snapshot = root.getSnapshot();
    const definition = snapshot?.sources[0]?.definition;
    expect(definition?.kind).toBe("source:browser");
    if (definition?.kind !== "source:browser") return;
    const browserDefinition = definition as BrowserSource;
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
      params: objectSchema<{ name: string }>((input) => {
        if (!isRecord(input) || typeof input.name !== "string") throw new Error("name required");
        return { name: input.name };
      }),
      view: ({ name }) => <div>{name}</div>,
    });
    const root = createComposerRoot({
      projectId: projectId("frame-test"),
      canvas: { width: 1920, height: 1080 },
    });

    await expect(
      root.render(
        <FrameProvider origin="http://127.0.0.1:4173">
          <Broadcast>
            <Scene id={sceneId("main")}>
              {/* @ts-expect-error Deliberately exercise runtime validation for untyped input. */}
              <View source={greeting} params={{}} />
            </Scene>
          </Broadcast>
        </FrameProvider>,
      ),
    ).rejects.toThrow(/name required/u);
    await root.dispose();
  });
});

function objectSchema<Params extends object>(
  parse: (input: unknown) => Params,
): { parse(input: unknown): Params } {
  return { parse };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
