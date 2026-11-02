// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Item, Snapshot, Source } from "../core/snapshot.js";
import { createAsyncQueue } from "../stream/async-queue.js";
import type { StreamMessage } from "../stream/messages.js";
import { Stage } from "./stage.js";
import { Stream } from "./stream.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

function item(id: string, sourceId: string, x: number): Item {
  const frame = { x, y: 0, width: 640, height: 360 };
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
    opacity: 1,
    rotation: 0,
  };
}

const chat: Source = {
  id: "chat",
  kind: "browser",
  props: { url: "https://example.com/chat", shutdownWhenHidden: false },
  size: { width: 1280, height: 720 },
};
const background: Source = {
  id: "bg",
  kind: "color",
  props: { color: "#000000" },
  size: { width: 1920, height: 1080 },
};

/** `chat` is shared by `main` and `brb`; `empty` places nothing. */
function update(revision: number, activeScene: string): StreamMessage {
  const snapshot: Snapshot = {
    revision,
    id: "show",
    canvas: { width: 1920, height: 1080 },
    activeScene,
    sources: [background, chat],
    scenes: [
      { id: "main", items: [item("bg", "bg", 0), item("main.chat", "chat", 40)] },
      { id: "brb", items: [item("brb.chat", "chat", 600)] },
      { id: "empty", items: [] },
    ],
  };
  return { kind: "update", snapshot };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 10; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function render(ui: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
  });
  return container;
}

function iframeIn(container: HTMLElement, layerId: string): HTMLIFrameElement | null {
  return container.querySelector(`[data-vignette-layer="${layerId}"] iframe`);
}

interface PreviewProps {
  readonly both: boolean;
}

describe("shared sources", () => {
  it("keep their element across scene switches", async () => {
    // The iframe moves from main's box to brb's, waits hidden while `empty` shows, and returns.
    const queue = createAsyncQueue<StreamMessage>();
    const container = render(
      <Stream source={queue}>
        <Stage />
      </Stream>,
    );
    queue.push({
      kind: "setup",
      id: "show",
      canvas: { width: 1920, height: 1080 },
      kinds: ["browser", "color"],
      assets: { version: "v1", entries: [] },
      serve: {},
    });
    queue.push(update(1, "main"));
    await settle();
    const page = iframeIn(container, "main.chat");
    expect(page?.getAttribute("src")).toBe("https://example.com/chat");

    queue.push(update(2, "brb"));
    await settle();
    expect(iframeIn(container, "brb.chat")).toBe(page);
    expect(container.querySelectorAll("iframe")).toHaveLength(1);

    queue.push(update(3, "empty"));
    await settle();
    expect(container.querySelector("[data-vignette-shared-host] iframe")).toBe(page);

    queue.push(update(4, "main"));
    await settle();
    expect(iframeIn(container, "main.chat")).toBe(page);
  });

  it("move only while connected, so moveBefore preserves the page", async () => {
    // With `moveBefore` available, no switch falls back to `append`, which would reload.
    const moves: Element[] = [];
    Object.defineProperty(Element.prototype, "moveBefore", {
      configurable: true,
      value(this: Element, node: Element, child: Node | null) {
        moves.push(node);
        this.insertBefore(node, child);
      },
    });
    const append = vi.spyOn(Element.prototype, "append");
    try {
      const queue = createAsyncQueue<StreamMessage>();
      render(
        <Stream source={queue}>
          <Stage />
        </Stream>,
      );
      queue.push({
        kind: "setup",
        id: "show",
        canvas: { width: 1920, height: 1080 },
        kinds: ["browser", "color"],
        assets: { version: "v1", entries: [] },
        serve: {},
      });
      queue.push(update(1, "main"));
      await settle();
      append.mockClear();
      for (const [revision, scene] of [
        [2, "brb"],
        [3, "empty"],
        [4, "main"],
      ] as const) {
        queue.push(update(revision, scene));
        await settle();
      }
      const slot = document.querySelector("[data-vignette-shared=chat]");
      expect(moves.filter((node) => node === slot).length).toBeGreaterThanOrEqual(3);
      expect(append.mock.calls.flat()).not.toContain(slot);
    } finally {
      Reflect.deleteProperty(Element.prototype, "moveBefore");
    }
  });

  it("keep an inline source's element mounted, hidden, while another scene shows", async () => {
    // An inline video lives as long as its layer: a switch away and back keeps its element.
    const intro: Source = {
      id: "intro",
      kind: "video",
      props: { src: "intro.mp4", loop: true, muted: true, restartOnShow: false },
      size: { width: 1920, height: 1080 },
    };
    const client = new QueryClient();
    client.setQueryData(["vignette", "asset", "sha256-intro"], "blob:intro");
    const switched = (revision: number, activeScene: string): StreamMessage => {
      const message = update(revision, activeScene);
      if (message.kind !== "update") return message;
      const { snapshot } = message;
      const [main, ...rest] = snapshot.scenes;
      if (main === undefined) return message;
      const scenes = [{ ...main, items: [...main.items, item("intro", "intro", 0)] }, ...rest];
      return {
        kind: "update",
        snapshot: { ...snapshot, sources: [...snapshot.sources, intro], scenes },
      };
    };
    const queue = createAsyncQueue<StreamMessage>();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <Stream source={queue}>
            <Stage />
          </Stream>
        </QueryClientProvider>,
      );
    });
    queue.push({
      kind: "setup",
      id: "show",
      canvas: { width: 1920, height: 1080 },
      kinds: ["browser", "color", "video"],
      assets: { version: "v1", entries: [{ name: "intro.mp4", hash: "sha256-intro" }] },
      serve: {},
    });
    queue.push(switched(1, "main"));
    await settle();
    const video = container.querySelector("[data-vignette-scene=main] video");
    expect(video?.getAttribute("src")).toBe("blob:intro");

    queue.push(switched(2, "brb"));
    await settle();
    const main = container.querySelector<HTMLElement>("[data-vignette-scene=main]");
    expect(main?.style.visibility).toBe("hidden");
    expect(main?.querySelector("video")).toBe(video);

    queue.push(switched(3, "main"));
    await settle();
    expect(container.querySelector("[data-vignette-scene=main] video")).toBe(video);
    expect(main?.style.visibility).toBe("");
  });

  it("show in the newest of two stages and return to the other when it unmounts", async () => {
    const queue = createAsyncQueue<StreamMessage>();
    function Preview({ both }: PreviewProps): ReactNode {
      return (
        <Stream source={queue}>
          <Stage scene="main" />
          {both ? <Stage scene="brb" /> : null}
        </Stream>
      );
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const client = new QueryClient();
    const show = (both: boolean) => {
      act(() => {
        root.render(
          <QueryClientProvider client={client}>
            <Preview both={both} />
          </QueryClientProvider>,
        );
      });
    };
    show(false);
    queue.push({
      kind: "setup",
      id: "show",
      canvas: { width: 1920, height: 1080 },
      kinds: ["browser", "color"],
      assets: { version: "v1", entries: [] },
      serve: {},
    });
    queue.push(update(1, "main"));
    await settle();
    const page = iframeIn(container, "main.chat");

    show(true);
    expect(iframeIn(container, "brb.chat")).toBe(page);
    show(false);
    expect(iframeIn(container, "main.chat")).toBe(page);
  });
});
