import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { asset } from "../assets.js";
import {
  box,
  broadcast,
  browserSource,
  colorSource,
  imageSource,
  layer,
  mediaSource,
  scene,
  sources,
} from "../builders.js";
import { compileBroadcast } from "./compile-layout.js";
import { yogaLayoutEngine } from "./layout-yoga.js";
import { createYogaWasmLayoutEngine } from "./layout-yoga-wasm.js";

const vendoredYoga = resolve(dirname(fileURLToPath(import.meta.url)), "../../vendor/yoga");

describe("compileBroadcast", () => {
  it("flattens a Yoga tree into deterministic absolute items", () => {
    const graph = programmeGraph();

    const result = compileBroadcast(graph, { revision: 7, layoutEngine: yogaLayoutEngine });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.snapshot.scenes[0]?.items.map(({ id, frame }) => ({ id, frame }))).toEqual([
      {
        id: "programme.background",
        frame: { x: 0, y: 0, width: 1920, height: 1080 },
      },
      { id: "programme.video", frame: { x: 48, y: 48, width: 896, height: 984 } },
      { id: "programme.web", frame: { x: 976, y: 48, width: 896, height: 984 } },
    ]);
    const repeated = compileBroadcast(graph, { revision: 7, layoutEngine: yogaLayoutEngine });
    expect(repeated.ok).toBe(true);
    if (repeated.ok)
      expect(JSON.stringify(result.snapshot)).toBe(JSON.stringify(repeated.snapshot));
  });

  it("lays out identically with the precompiled Yoga Wasm module used by Workers", async () => {
    const wasm = await WebAssembly.compile(readFileSync(resolve(vendoredYoga, "yoga.wasm")));
    const layoutEngine = await createYogaWasmLayoutEngine(wasm);
    const graph = programmeGraph();

    expect(compileBroadcast(graph, { revision: 3, layoutEngine })).toEqual(
      compileBroadcast(graph, { revision: 3, layoutEngine: yogaLayoutEngine }),
    );
  });

  it("defaults color sizes to the canvas and browser viewports to their layer size", () => {
    // One placed and one unplaced browser source show both viewport defaults; the color fills the canvas.
    const result = compileBroadcast(
      broadcast({
        projectId: "defaults",
        canvas: { width: 1280, height: 720 },
        children: [
          sources(
            colorSource({ id: "background", color: "#000000" }),
            browserSource({ id: "lower-third", url: "/__vignette/frame/lower-third" }),
            browserSource({ id: "unplaced", url: "/__vignette/frame/unplaced" }),
          ),
          scene({
            id: "main",
            children: [
              layer({
                id: "background",
                sourceId: "background",
                style: { width: "100%", height: "100%" },
              }),
              layer({
                id: "lower-third",
                sourceId: "lower-third",
                style: {
                  position: "absolute",
                  inset: { left: 40, bottom: 40 },
                  width: 600,
                  height: 120,
                },
              }),
            ],
          }),
        ],
      }),
      { revision: 1, layoutEngine: yogaLayoutEngine },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byId = new Map(result.snapshot.sources.map((source) => [source.id, source]));
    expect(byId.get("background")?.definition).toMatchObject({
      size: { width: 1280, height: 720 },
    });
    expect(byId.get("background")?.intrinsicSize).toEqual({ width: 1280, height: 720 });
    expect(byId.get("lower-third")?.definition).toMatchObject({
      viewport: { width: 600, height: 120 },
    });
    expect(byId.get("unplaced")?.definition).toMatchObject({
      viewport: { width: 1280, height: 720 },
    });
  });

  it("requires a viewport for browser sources placed at different sizes", () => {
    const result = compileBroadcast(
      broadcast({
        projectId: "defaults",
        children: [
          sources(browserSource({ id: "shared", url: "/__vignette/frame/shared" })),
          scene({
            id: "small",
            children: [
              layer({ id: "small", sourceId: "shared", style: { width: 320, height: 180 } }),
            ],
          }),
          scene({
            id: "large",
            children: [
              layer({ id: "large", sourceId: "shared", style: { width: 640, height: 360 } }),
            ],
          }),
        ],
      }),
      { revision: 1, layoutEngine: yogaLayoutEngine },
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "INVALID_SOURCE_SIZE",
        path: "broadcast.children[0].children[0].viewport",
        relatedIds: ["shared"],
      }),
    );
  });

  it("vendors the Yoga build of the pinned yoga-layout dependency", () => {
    const yogaRoot = resolve(
      dirname(createRequire(import.meta.url).resolve("yoga-layout/load")),
      "../..",
    );
    const glue = readFileSync(resolve(yogaRoot, "dist/binaries/yoga-wasm-base64-esm.js"), "utf8");
    const embedded = /"data:application\/octet-stream;base64,([A-Za-z0-9+/=]{64,})"/u.exec(glue);

    // Run `pnpm --filter @strangecyan/vignette-core vendor:yoga` when this fails.
    expect(embedded?.[1]).toBe(readFileSync(resolve(vendoredYoga, "yoga.wasm")).toString("base64"));
  });
});

function programmeGraph() {
  return broadcast({
    projectId: "demo",
    children: [
      sources(
        imageSource({
          id: "background",
          asset: asset("background.png"),
          size: { width: 1920, height: 1080 },
        }),
        mediaSource({
          id: "video",
          asset: asset("video.mp4"),
          size: { width: 1920, height: 1080 },
        }),
        browserSource({
          id: "web",
          url: "https://example.test/graphic",
          viewport: { width: 800, height: 450 },
        }),
      ),
      scene({
        id: "programme",
        children: [
          box({
            style: {
              width: "100%",
              height: "100%",
              flexDirection: "row",
              padding: 48,
              gap: 32,
            },
            children: [
              layer({
                id: "programme.background",
                sourceId: "background",
                style: { position: "absolute", inset: 0 },
                fit: "cover",
              }),
              layer({
                id: "programme.video",
                sourceId: "video",
                style: { flexGrow: 1 },
                fit: "cover",
              }),
              layer({
                id: "programme.web",
                sourceId: "web",
                style: { flexGrow: 1 },
                fit: "contain",
              }),
            ],
          }),
        ],
      }),
    ],
  });
}
