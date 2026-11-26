// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { AudioChannelSchema, type AudioChannel } from "@strangecyan/vignette";
import type { DomPluginContext } from "@strangecyan/vignette/dom";

import { moqDom } from "./dom.js";
import type { MoqProps } from "./watch.js";

const size = { width: 1280, height: 720 };

function source(props: Partial<MoqProps>, audio?: AudioChannel) {
  return {
    id: "live",
    kind: "moq",
    size,
    audio,
    props: {
      url: "https://cdn.moq.dev/demo",
      broadcast: "bbb.hang",
      size,
      latencyMs: 100,
      video: true,
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
      source({ latencyMs: 250, disableWhenHidden: false }),
      context(),
    );
    const watch = handle.element;
    expect(watch.tagName.toLowerCase()).toBe("moq-watch");
    expect(watch.getAttribute("url")).toBe("https://cdn.moq.dev/demo");
    expect(watch.getAttribute("name")).toBe("bbb.hang");
    expect(watch.getAttribute("latency")).toBe("250");
    expect(watch.hasAttribute("muted")).toBe(true);
    expect(watch.getAttribute("visible")).toBe("always");
    expect(watch.dataset.vignetteMoqQuality).toBe("auto");
    expect(watch.querySelector("canvas")).not.toBeNull();

    // With a channel the element fetches and plays the audio itself.
    await handle.update?.(
      source({ broadcast: "other", quality: "hd" }, AudioChannelSchema.parse({})),
    );
    expect(handle.element).toBe(watch);
    expect(watch.getAttribute("name")).toBe("other");
    expect(watch.hasAttribute("muted")).toBe(false);
    expect(watch.getAttribute("visible")).toBe("0px");
    expect(watch.dataset.vignetteMoqQuality).toBe("hd");

    await handle.dispose?.();
    expect(watch.hasAttribute("url")).toBe(false);
    expect(watch.hasAttribute("name")).toBe(false);
  });

  it("hands the target its canvas, which a negative sync offset delays", async () => {
    const handle = await moqDom.create(source({}), context());
    expect(handle.media?.video).toBe(handle.element.querySelector("canvas"));
    await handle.dispose?.();
  });

  it("never downloads video when the video track is off", async () => {
    const handle = await moqDom.create(source({ video: false }), context());
    expect(handle.element.getAttribute("visible")).toBe("never");
  });
});
