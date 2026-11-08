import { describe, expect, it } from "vitest";

import type { SourceDefinition } from "./define-source.js";
import type { InlineSource, LayoutNode, ShowTree, SourceRef } from "./show-tree.js";
import { Browser } from "./sources/browser.js";
import { Color } from "./sources/color.js";
import { Frame } from "./sources/frame.js";
import { Image } from "./sources/image.js";
import type { Source } from "./snapshot.js";
import { validateShow, type ValidateOptions } from "./validate.js";

const canvas = { width: 1280, height: 720 };
const definitions = new Map<string, SourceDefinition>(
  [Browser, Color, Frame, Image].map((component) => [
    component.definition.kind,
    component.definition,
  ]),
);
const fullServe = {
  stream: "https://show.example/stream",
  assets: "https://show.example/assets/",
  frames: "https://show.example/frames.html",
};

describe("validateShow", () => {
  it("accepts a well-formed show", () => {
    const tree = show({
      sharedSources: [shared("chat", "browser")],
      scenes: [
        scene("main", [placed("main.0", { ref: "chat" }), placed("main.1", inline("main.1"))]),
      ],
      activeScene: "main",
    });

    expect(validate(tree)).toEqual([]);
  });

  it("reports duplicate scene, layer and source IDs at their scope", () => {
    const tree = show({
      sharedSources: [shared("chat", "browser"), shared("chat", "browser")],
      scenes: [
        scene("main", [placed("camera", inline("main.camera")), placed("camera", inline("x"))]),
        scene("main", []),
        scene("brb", [placed("camera", inline("main.camera"))]),
      ],
    });

    expect(codes(validate(tree))).toEqual([
      ["DUPLICATE_SCENE_ID", "scene.main"],
      ["DUPLICATE_LAYER_ID", "scene.main.layer.camera"],
      ["DUPLICATE_SOURCE_ID", "source.chat"],
      ["DUPLICATE_SOURCE_ID", "source.main.camera"],
    ]);
  });

  it("reports a <Use> of an undeclared source and a shared source placed twice in one scene", () => {
    const tree = show({
      sharedSources: [shared("chat", "browser")],
      scenes: [
        scene("main", [
          placed("main.0", { ref: "chat" }),
          placed("main.1", { ref: "chat" }),
          placed("main.2", { ref: "camera" }),
        ]),
        scene("brb", [placed("brb.0", { ref: "chat" })]),
      ],
    });

    expect(codes(validate(tree))).toEqual([
      ["MISSING_SOURCE", "scene.main.layer.main.2"],
      ["DUPLICATE_PLACEMENT", "scene.main.use.chat"],
    ]);
  });

  it("reports an activeScene that names no scene", () => {
    const tree = show({ scenes: [scene("main", [])], activeScene: "brb" });

    expect(codes(validate(tree))).toEqual([["UNKNOWN_ACTIVE_SCENE", "show.activeScene"]]);
  });

  it("requires serve.assets when an asset-bearing kind is used", () => {
    const tree = show({ sharedSources: [shared("logo", "image", { src: "logo.png" })] });

    expect(codes(validate(tree, { assets: manifest("logo.png"), serve: {} }))).toEqual([
      ["MISSING_SERVE", "serve.assets"],
    ]);
  });

  it("requires serve.frames and serve.stream when a frame is used", () => {
    const tree = show({
      sharedSources: [shared("score", "frame", { frame: "Score", params: {} })],
    });

    expect(codes(validate(tree, { serve: { assets: fullServe.assets } }))).toEqual([
      ["MISSING_SERVE", "serve.frames"],
      ["MISSING_SERVE", "serve.stream"],
    ]);
  });

  it("reports an asset name missing from the manifest", () => {
    const tree = show({
      scenes: [scene("main", [placed("main.0", inline("main.0", "image", { src: "intro.png" }))])],
    });

    expect(codes(validate(tree, { assets: manifest("logo.png") }))).toEqual([
      ["MISSING_ASSET", "source.main.0.props.src"],
    ]);
    expect(validate(tree, { assets: manifest("intro.png") })).toEqual([]);
  });
});

interface ShowParts {
  readonly sharedSources?: readonly Source[];
  readonly scenes?: ShowTree["scenes"];
  readonly activeScene?: string;
}

function show(parts: ShowParts): ShowTree {
  return {
    id: "weekly",
    canvas,
    activeScene: parts.activeScene,
    sharedSources: parts.sharedSources ?? [],
    scenes: parts.scenes ?? [],
  };
}

function scene(id: string, children: readonly LayoutNode[]): ShowTree["scenes"][number] {
  return { id, root: { id, layer: {}, kind: "layer", props: {}, children } };
}

function placed(id: string, source: InlineSource | SourceRef): LayoutNode {
  return { id, layer: {}, kind: "layer", props: {}, source };
}

function inline(
  id: string,
  kind = "color",
  props: Source["props"] = { color: "#000000" },
): InlineSource {
  return { id, kind, props, size: () => canvas };
}

function shared(id: string, kind: string, props: Source["props"] = {}): Source {
  return { id, kind, props, size: canvas };
}

function manifest(...names: readonly string[]) {
  return {
    version: "v1",
    entries: names.map((name) => ({ name, hash: `sha256-${name}` as const })),
  };
}

function validate(tree: ShowTree, options: Partial<ValidateOptions> = {}) {
  return validateShow(tree, {
    definitions,
    assets: manifest(),
    serve: fullServe,
    ...options,
  });
}

function codes(diagnostics: ReturnType<typeof validateShow>): string[][] {
  return diagnostics.map((item) => [item.code, item.path]);
}
