import { describe, expect, it } from "vitest";

import { asset } from "./assets.js";
import { broadcast, imageSource, layer, scene, sceneLayer, sources } from "./builders.js";
import type { SourceDefinition } from "./sources.js";
import { validateBroadcast } from "./validation.js";

describe("validateBroadcast", () => {
  it("accepts a minimal referenced source", () => {
    const graph = broadcast({
      projectId: "weekly-show",
      children: [
        sources(imageSource({ id: "logo", asset: asset("branding/logo.png") })),
        scene({ id: "programme", children: [layer({ id: "programme.logo", sourceId: "logo" })] }),
      ],
    });

    expect(validateBroadcast(graph)).toMatchObject({ valid: true, diagnostics: [] });
  });

  it("reports missing references and unreachable declarations", () => {
    const graph = broadcast({
      projectId: "weekly-show",
      children: [
        sources(imageSource({ id: "unused", asset: asset("unused.png") })),
        scene({ id: "programme", children: [layer({ id: "missing", sourceId: "unknown" })] }),
      ],
    });

    expect(validateBroadcast(graph).diagnostics.map(({ code }) => code)).toEqual([
      "UNREACHABLE_SOURCE",
      "MISSING_SOURCE",
    ]);
  });

  it("detects nested scene cycles", () => {
    const graph = broadcast({
      projectId: "weekly-show",
      children: [
        scene({ id: "a", children: [sceneLayer({ id: "a.b", sceneId: "b" })] }),
        scene({ id: "b", children: [sceneLayer({ id: "b.a", sceneId: "a" })] }),
      ],
    });

    expect(validateBroadcast(graph).diagnostics.some(({ code }) => code === "SCENE_CYCLE")).toBe(
      true,
    );
  });

  it("rejects source kinds without a registered module", () => {
    const unknown = { kind: "source:unknown", id: "mystery" } as unknown as SourceDefinition;
    const graph = broadcast({
      projectId: "weekly-show",
      children: [
        sources(unknown),
        scene({ id: "programme", children: [layer({ id: "mystery", sourceId: "mystery" })] }),
      ],
    });

    const result = validateBroadcast(graph);
    expect(result.valid).toBe(false);
    expect(result.errors.map(({ code }) => code)).toEqual(["UNKNOWN_SOURCE_KIND"]);
  });
});
