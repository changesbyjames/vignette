// @vitest-environment jsdom

import type { AnySourceDefinition, CompiledItem } from "@strangecyan/vignette-core";
import { describe, expect, it } from "vitest";

import { createPlaceholderRenderer } from "./browser.js";

describe("createPlaceholderRenderer", () => {
  it("shows source identity, settings, and computed size", () => {
    const renderer = createPlaceholderRenderer("source:media-file");
    const view = renderer.create(document);
    const source = {
      kind: "source:media-file",
      id: "intro",
      label: "Opening clip",
      asset: { kind: "asset", name: "intro.mp4" },
      muted: true,
    } as unknown as AnySourceDefinition;
    const item = {
      frame: { x: 0, y: 0, width: 640, height: 360 },
    } as unknown as CompiledItem;

    view.update(source, item);

    expect(view.element.dataset.vignettePlaceholder).toBe("");
    expect(view.element.textContent).toContain("Opening clip");
    expect(view.element.textContent).toContain("source:media-file");
    expect(view.element.textContent).toContain("asset: intro.mp4");
    expect(view.element.textContent).toContain("640 x 360");
  });
});
