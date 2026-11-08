import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { Size } from "../geometry.js";
import type { InlineSource, LayoutNode, ShowTree, SourceRef } from "../show-tree.js";
import type { LayerProps, LayoutStyle } from "../snapshot.js";
import { compileShow } from "./compile.js";
import { loadYoga } from "./load-yoga.js";
import { yogaLayoutEngine } from "./yoga.js";

const vendoredYoga = resolve(dirname(fileURLToPath(import.meta.url)), "../../../vendor/yoga");
const hd: Size = { width: 1920, height: 1080 };

describe("compileShow", () => {
  it("flattens a Yoga tree into deterministic absolute items", () => {
    const tree = programmeTree();

    const result = compileShow(tree, { revision: 7, layoutEngine: yogaLayoutEngine });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.snapshot.scenes[0]?.items.map(({ id, frame }) => ({ id, frame }))).toEqual([
      { id: "background", frame: { x: 0, y: 0, width: 1920, height: 1080 } },
      { id: "video", frame: { x: 48, y: 48, width: 896, height: 984 } },
      { id: "web", frame: { x: 976, y: 48, width: 896, height: 984 } },
    ]);
    const repeated = compileShow(tree, { revision: 7, layoutEngine: yogaLayoutEngine });
    expect(repeated.ok).toBe(true);
    if (repeated.ok)
      expect(JSON.stringify(result.snapshot)).toBe(JSON.stringify(repeated.snapshot));
  });

  it("lays out identically with the precompiled Yoga Wasm module used by Workers", async () => {
    const wasm = await WebAssembly.compile(readFileSync(resolve(vendoredYoga, "yoga.wasm")));
    const layoutEngine = await loadYoga(wasm);
    const tree = programmeTree();

    expect(compileShow(tree, { revision: 3, layoutEngine })).toEqual(
      compileShow(tree, { revision: 3, layoutEngine: yogaLayoutEngine }),
    );
  });

  it("sizes inline sources from their layer's laid-out frame", () => {
    const result = compileShow(
      {
        id: "defaults",
        canvas: { width: 1280, height: 720 },
        sharedSources: [],
        scenes: [
          {
            id: "main",
            root: group("main", { width: "100%", height: "100%" }, [
              placed("lower-third", layerSized("lower-third"), {
                position: "absolute",
                left: 40,
                bottom: 40,
                width: 600,
                height: 120,
              }),
            ]),
          },
        ],
      },
      { revision: 1, layoutEngine: yogaLayoutEngine },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.sources).toEqual([
      { id: "lower-third", kind: "browser", props: {}, size: { width: 600, height: 120 } },
    ]);
    expect(result.snapshot.scenes[0]?.items[0]?.frame).toEqual({
      x: 40,
      y: 560,
      width: 600,
      height: 120,
    });
  });

  it("vendors the Yoga build of the pinned yoga-layout dependency", () => {
    const yogaRoot = resolve(
      dirname(createRequire(import.meta.url).resolve("yoga-layout/load")),
      "../..",
    );
    const glue = readFileSync(resolve(yogaRoot, "dist/binaries/yoga-wasm-base64-esm.js"), "utf8");
    const embedded = /"data:application\/octet-stream;base64,([A-Za-z0-9+/=]{64,})"/u.exec(glue);

    // Run `pnpm --filter vignette vendor:yoga` when this fails.
    expect(embedded?.[1]).toBe(readFileSync(resolve(vendoredYoga, "yoga.wasm")).toString("base64"));
  });
});

function programmeTree(): ShowTree {
  return {
    id: "demo",
    canvas: hd,
    sharedSources: [{ id: "web", kind: "browser", props: {}, size: { width: 800, height: 450 } }],
    scenes: [
      {
        id: "programme",
        root: group(
          "programme",
          { width: "100%", height: "100%", flexDirection: "row", padding: 48, gap: 32 },
          [
            placed(
              "background",
              fixed("background", "image"),
              { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
              { fit: "cover" },
            ),
            placed("video", fixed("video", "video"), { flexGrow: 1 }, { fit: "cover" }),
            placed("web", { ref: "web" }, { flexGrow: 1 }, { fit: "contain" }),
          ],
        ),
      },
    ],
  };
}

function group(id: string, style: LayoutStyle, children: readonly LayoutNode[]): LayoutNode {
  return { id, style, layer: {}, kind: "layer", props: {}, children };
}

function placed(
  id: string,
  source: InlineSource | SourceRef,
  style: LayoutStyle,
  layer: LayerProps = {},
): LayoutNode {
  return { id, style, layer, kind: "layer", props: {}, source };
}

function fixed(id: string, kind: string): InlineSource {
  return { id, kind, props: {}, size: () => hd };
}

function layerSized(id: string): InlineSource {
  return { id, kind: "browser", props: {}, size: (layer) => layer };
}
