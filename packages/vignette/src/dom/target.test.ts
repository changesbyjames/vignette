// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { Item, Snapshot, Source } from "../core/snapshot.js";
import type { SetupMessage, StreamMessage } from "../stream/messages.js";
import type { DomSourcePlugin } from "./plugin.js";
import { domTarget } from "./target.js";

function setup(kinds: readonly string[]): SetupMessage {
  return {
    kind: "setup",
    id: "show",
    canvas: { width: 1920, height: 1080 },
    kinds,
    assets: { version: "v1", entries: [] },
    serve: {},
  };
}

function item(id: string, sourceId: string, x: number, width: number): Item {
  const frame = { x, y: 20, width, height: 100 };
  return {
    id,
    sourceId,
    frame,
    placement: {
      destination: frame,
      sourceCrop: { top: 0, right: 0, bottom: 0, left: 0 },
      alignment: { horizontal: "center", vertical: "center" },
    },
    visible: true,
    opacity: 0.5,
    rotation: 0,
  };
}

const background: Source = {
  id: "bg",
  kind: "color",
  props: { color: "#102030" },
  size: { width: 1920, height: 1080 },
};

const chat: Source = {
  id: "chat",
  kind: "browser",
  props: { url: "https://example.com/chat", shutdownWhenHidden: false },
  size: { width: 1280, height: 720 },
};

/** Two scenes sharing the `chat` source, and an empty one. */
function showSnapshot(revision: number, activeScene: string): StreamMessage {
  const snapshot: Snapshot = {
    revision,
    id: "show",
    canvas: { width: 1920, height: 1080 },
    activeScene,
    sources: [background, chat],
    scenes: [
      { id: "main", items: [item("bg", "bg", 0, 1920), item("main.chat", "chat", 40, 640)] },
      { id: "brb", items: [item("brb.chat", "chat", 200, 1280)] },
      { id: "empty", items: [] },
    ],
  };
  return { kind: "update", snapshot };
}

function mount(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  return container;
}

describe("domTarget", () => {
  it("positions each item from its compiled frame and presentation", async () => {
    // The wrapper takes the item frame; the iframe keeps its viewport and is scaled into it.
    const container = mount();
    const target = domTarget(container);
    target.apply(setup(["color", "browser"]));
    target.apply(showSnapshot(1, "main"));
    await target.settled(1);
    await waitFor(() => container.querySelectorAll("iframe").length === 1);

    const wrapper = container.querySelector<HTMLElement>("[data-vignette-layer='main.chat']");
    expect(wrapper?.style).toMatchObject({
      left: "40px",
      top: "20px",
      width: "640px",
      height: "100px",
      opacity: "0.5",
    });
    const frame = wrapper?.querySelector("iframe");
    expect(frame?.getAttribute("src")).toBe("https://example.com/chat");
    expect(frame?.style).toMatchObject({ width: "1280px", height: "720px" });
    expect(frame?.style.transform).toBe("scale(0.5, 0.1388888888888889)");

    const fill = container.querySelector<HTMLElement>("[data-vignette-layer='bg'] div div");
    expect(fill?.style.background).toMatch(/rgb\(16, 32, 48\)|#102030/u);
    expect(target.status).toMatchObject({
      phase: "settled",
      sources: { bg: "live", chat: "live" },
    });

    await target.dispose();
    expect(container.childElementCount).toBe(0);
  });

  it("keeps one element for a shared source across scene switches", async () => {
    const container = mount();
    const target = domTarget(container);
    target.apply(setup(["color", "browser"]));
    target.apply(showSnapshot(1, "main"));
    await target.settled(1);
    await waitFor(() => container.querySelector("iframe") !== null);
    const frame = container.querySelector("iframe");

    target.apply(showSnapshot(2, "brb"));
    await target.settled(2);
    expect(container.querySelector("[data-vignette-layer='main.chat']")).toBeNull();
    expect(container.querySelector("[data-vignette-layer='brb.chat'] iframe")).toBe(frame);

    target.apply(showSnapshot(3, "empty"));
    await target.settled(3);
    expect(container.querySelector("[data-vignette-layer]")).toBeNull();
    expect(container.querySelector("[data-vignette-parking] iframe")).toBe(frame);

    target.apply(showSnapshot(4, "main"));
    await target.settled(4);
    expect(container.querySelector("[data-vignette-layer='main.chat'] iframe")).toBe(frame);
    await target.dispose();
  });

  it("renders text with its style as CSS and updates it in place", async () => {
    const container = mount();
    const target = domTarget(container);
    const title = (text: string): StreamMessage => ({
      kind: "update",
      snapshot: {
        revision: text.length,
        id: "show",
        canvas: { width: 1920, height: 1080 },
        sources: [
          {
            id: "title",
            kind: "text",
            props: { text, style: { fontSize: 64, color: "#ffffff", textAlign: "center" } },
            size: { width: 640, height: 100 },
          },
        ],
        scenes: [{ id: "main", items: [item("title", "title", 0, 640)] }],
      },
    });
    target.apply(setup(["text"]));
    target.apply(title("Up next\nThe roundup"));
    // `create` is asynchronous: the source is preparing until its element exists.
    const paragraph = await vi.waitFor(() => {
      const found = container.querySelector("p");
      if (found === null) throw new Error("The text has not rendered yet.");
      return found;
    });
    expect(paragraph.textContent).toBe("Up next\nThe roundup");
    expect(paragraph.style.textAlign).toBe("center");
    expect(paragraph.style.fontSize).toBe("64px");

    target.apply(title("Live"));
    await vi.waitFor(() => {
      expect(paragraph.textContent).toBe("Live");
    });
    expect(container.querySelector("p")).toBe(paragraph);
    await target.dispose();
  });

  it("shows only the configured scene when one is given", async () => {
    const container = mount();
    const target = domTarget(container, { scene: "brb" });
    target.apply(setup(["color", "browser"]));
    target.apply(showSnapshot(1, "main"));
    await target.settled(1);
    expect(container.querySelector("[data-vignette-layer='brb.chat']")).not.toBeNull();
    expect(container.querySelector("[data-vignette-layer='bg']")).toBeNull();
    await target.dispose();
  });

  it("lets later plugins replace a built-in kind", async () => {
    const container = mount();
    const custom: DomSourcePlugin = {
      kind: "color",
      create(_source, { document }) {
        const element = document.createElement("section");
        element.dataset.custom = "";
        return { element };
      },
    };
    const target = domTarget(container, { sources: [custom] });
    target.apply(setup(["color", "browser"]));
    target.apply(showSnapshot(1, "main"));
    await target.settled(1);
    await waitFor(() => container.querySelector("[data-custom]") !== null);
    expect(container.querySelector("[data-vignette-layer='bg'] section")).not.toBeNull();
    await target.dispose();
  });

  it("reports missing plugins without builtins and renders nothing", async () => {
    const container = mount();
    const target = domTarget(container, { builtins: false });
    target.apply(setup(["color", "browser"]));
    target.apply(showSnapshot(1, "main"));
    await expect(target.settled(1)).rejects.toThrow('missing source plugin for kind "color"');
    expect(target.status.phase).toBe("error");
    expect(target.status.error?.message).toContain('missing source plugin for kind "browser"');
    expect(container.querySelector("[data-vignette-layer]")).toBeNull();
    await target.dispose();
  });
});

/** Polls a condition across macrotasks, for handles that resolve asynchronously. */
async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Condition was not met.");
}
