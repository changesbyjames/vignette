// @vitest-environment jsdom

import { layerId, sourceId, type CompiledItem } from "@cbj/react-obs-core";
import { describe, expect, it } from "vitest";

import { moqDomRenderer } from "./dom.js";
import type { MoqSource } from "./index.js";

const item: CompiledItem = {
  id: layerId("live-layer"),
  content: { kind: "source", sourceId: sourceId("live") },
  frame: { x: 0, y: 0, width: 1280, height: 720 },
  visible: true,
  opacity: 1,
  rotation: 0,
};

describe("moqDomRenderer", () => {
  it("maps the neutral source to @moq/watch attributes", () => {
    const source: MoqSource = {
      kind: "source:moq",
      id: sourceId("live"),
      url: "https://cdn.moq.dev/demo",
      broadcast: "bbb.hang",
      size: { width: 1280, height: 720 },
      latencyMs: 250,
      audio: false,
      quality: "auto",
      disableWhenHidden: false,
    };
    const view = moqDomRenderer.create(document);
    view.update(source, item);

    const watch = view.element;
    expect(watch.tagName.toLowerCase()).toBe("moq-watch");
    expect(watch.getAttribute("url")).toBe("https://cdn.moq.dev/demo");
    expect(watch.getAttribute("name")).toBe("bbb.hang");
    expect(watch.getAttribute("latency")).toBe("250");
    expect(watch.hasAttribute("muted")).toBe(true);
    expect(watch.getAttribute("visible")).toBe("always");
    expect(watch.dataset.reactObsMoqQuality).toBe("auto");
    expect(watch.querySelector("canvas")).not.toBeNull();

    view.dispose();
    expect(watch.hasAttribute("url")).toBe(false);
    expect(watch.hasAttribute("name")).toBe(false);
  });

  it("defaults latency, keeps audio, and pauses offscreen video by default", () => {
    const source: MoqSource = {
      kind: "source:moq",
      id: sourceId("live"),
      url: "https://cdn.moq.dev/demo",
      broadcast: "bbb.hang",
      size: { width: 1280, height: 720 },
    };
    const view = moqDomRenderer.create(document);
    view.update(source, item);

    const watch = view.element;
    expect(watch.getAttribute("latency")).toBe("100");
    expect(watch.hasAttribute("muted")).toBe(false);
    expect(watch.getAttribute("visible")).toBe("0px");
  });

  it("only retains hidden sources that opt out of disableWhenHidden", () => {
    const base = {
      kind: "source:moq",
      id: sourceId("live"),
      url: "https://cdn.moq.dev/demo",
      broadcast: "bbb.hang",
      size: { width: 1280, height: 720 },
    } as const;
    expect(moqDomRenderer.retainWhenHidden?.(base)).toBe(false);
    expect(moqDomRenderer.retainWhenHidden?.({ ...base, disableWhenHidden: false })).toBe(true);
  });
});
