// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { DomPluginContext } from "@strangecyan/vignette/dom";

import { moqDom } from "./dom.js";
import type { MoqProps } from "./watch.js";

const size = { width: 1280, height: 720 };

interface RenditionTarget {
  readonly name?: string;
  readonly width?: number;
}

function source(props: Partial<MoqProps>) {
  return {
    id: "live",
    kind: "moq",
    size,
    props: {
      url: "https://cdn.moq.dev/demo",
      broadcast: "bbb.hang",
      size,
      latencyMs: 100,
      video: true,
      audio: true,
      quality: "auto",
      disableWhenHidden: true,
      ...props,
    },
  };
}

function context(): DomPluginContext {
  return {
    document,
    canvas: { width: 1920, height: 1080 },
    signal: new AbortController().signal,
    assets: { resolve: (name) => Promise.resolve(name) },
    frames: () => "",
  };
}

describe("moqDom", () => {
  it("maps props to <moq-watch> attributes and updates them in place", async () => {
    const handle = await moqDom.create(
      source({ latencyMs: 250, audio: false, disableWhenHidden: false }),
      context(),
    );
    const watch = handle.element;
    expect(watch.tagName.toLowerCase()).toBe("moq-watch");
    expect(watch.getAttribute("url")).toBe("https://cdn.moq.dev/demo");
    expect(watch.getAttribute("name")).toBe("bbb.hang");
    expect(watch.getAttribute("delay")).toBe("250ms");
    expect(watch.hasAttribute("latency")).toBe(false);
    expect(watch.hasAttribute("muted")).toBe(true);
    expect(watch.getAttribute("visible")).toBe("always");
    expect(watch.dataset.vignetteMoqQuality).toBe("auto");
    expect(watch.querySelector("canvas")).not.toBeNull();

    await handle.update?.(source({ broadcast: "other", quality: "hd" }));
    expect(handle.element).toBe(watch);
    expect(watch.getAttribute("name")).toBe("other");
    expect(watch.getAttribute("delay")).toBe("100ms");
    expect(watch.hasAttribute("muted")).toBe(false);
    expect(watch.getAttribute("visible")).toBe("0px");
    expect(watch.dataset.vignetteMoqQuality).toBe("hd");

    await handle.dispose?.();
    expect(watch.hasAttribute("url")).toBe(false);
    expect(watch.hasAttribute("name")).toBe(false);
  });

  it("never downloads video when the video track is off", async () => {
    const handle = await moqDom.create(source({ video: false }), context());
    expect(handle.element.getAttribute("visible")).toBe("never");
  });

  it("changes renditions through the player's controls without losing its size target", async () => {
    // Select, reapply, then release a manual rendition while keeping the player's sizing target.
    const handle = await moqDom.create(source({}), context());
    type Target = RenditionTarget | undefined;
    let target: Target = { width: 640 };
    Object.defineProperty(handle.element, "controls", {
      value: {
        target: {
          update(update: (current: Target) => Target) {
            target = update(target);
          },
        },
      },
    });

    await handle.update?.(source({ quality: "hd", latencyMs: 0 }));
    expect(target).toEqual({ width: 640, name: "hd" });
    expect(handle.element.getAttribute("delay")).toBe("0ms");

    const unchanged = target;
    await handle.update?.(source({ quality: "hd" }));
    expect(target).toBe(unchanged);

    await handle.update?.(source({ quality: "auto" }));
    expect(target).toEqual({ width: 640, name: undefined });
    await handle.dispose?.();
  });
});
