import { describe, expect, it } from "vitest";

import { asset } from "./assets.js";
import {
  broadcast,
  browserSource,
  imageSource,
  layer,
  scene,
  sceneLayer,
  sources,
} from "./builders.js";
import type { AnySourceDefinition } from "./sources.js";
import { resolveResourceUrl } from "./resource-url.js";
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

  it("reports malformed plain-string IDs as diagnostics instead of throwing", () => {
    const graph = broadcast({
      projectId: "weekly show",
      children: [
        sources(imageSource({ id: "", asset: asset("logo.png") })),
        scene({ id: " programme", children: [layer({ id: "-logo", sourceId: "" })] }),
      ],
    });

    expect(validateBroadcast(graph).errors.map(({ code, path }) => ({ code, path }))).toEqual(
      expect.arrayContaining([
        { code: "INVALID_PROJECT_ID", path: "broadcast.projectId" },
        { code: "INVALID_SCENE_ID", path: expect.stringMatching(/\.id$/u) },
        { code: "INVALID_SOURCE_ID", path: expect.stringMatching(/\.id$/u) },
        { code: "INVALID_LAYER_ID", path: expect.stringMatching(/\.id$/u) },
      ]),
    );
  });

  it("rejects source kinds without a registered module", () => {
    const unknown: AnySourceDefinition = { kind: "source:unknown", id: "mystery" };
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

  it("accepts absolute HTTP(S) and root-relative browser URLs only", () => {
    const urlDiagnostics = (url: string) =>
      validateBroadcast(
        broadcast({
          projectId: "weekly-show",
          children: [
            sources(browserSource({ id: "page", url, viewport: { width: 640, height: 360 } })),
            scene({ id: "programme", children: [layer({ id: "page", sourceId: "page" })] }),
          ],
        }),
      ).errors.map(({ code }) => code);

    expect(urlDiagnostics("https://example.com/overlay")).toEqual([]);
    expect(urlDiagnostics("/__vignette/frame/label?props=%7B%7D")).toEqual([]);
    for (const url of ["//evil.example/x", "/\\evil.example/x", "overlay.html", "file:///x"]) {
      expect(urlDiagnostics(url)).toEqual(["INVALID_BROWSER_URL"]);
    }
  });
});

describe("resolveResourceUrl", () => {
  it("keeps absolute URLs and resolves root-relative URLs against the base origin", () => {
    expect(resolveResourceUrl("https://cdn.example/a.png", "http://host:4173/stream")).toBe(
      "https://cdn.example/a.png",
    );
    expect(resolveResourceUrl("/assets/a.png?v=1", "http://host:4173/api/stream")).toBe(
      "http://host:4173/assets/a.png?v=1",
    );
    expect(() => resolveResourceUrl("/assets/a.png", undefined)).toThrow(/no base URL/u);
  });
});
