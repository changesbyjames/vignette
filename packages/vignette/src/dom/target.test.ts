// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { AudioChannelSchema, type AudioChannelInput } from "../core/audio.js";
import type { Item, Snapshot, Source } from "../core/snapshot.js";
import type { SetupMessage, StreamMessage } from "../stream/messages.js";
import type { DomSourcePlugin } from "./plugin.js";
import { domTarget } from "./target.js";

function setup(): SetupMessage {
  return {
    kind: "setup",
    id: "show",
    canvas: { width: 1920, height: 1080 },
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
    target.apply(setup());
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
    // A dark host's scheme would give the transparent page an opaque backdrop.
    expect(frame?.style.colorScheme).toBe("normal");
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
    target.apply(setup());
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
    target.apply(setup());
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
    target.apply(setup());
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
    target.apply(setup());
    target.apply(showSnapshot(1, "main"));
    await target.settled(1);
    await waitFor(() => container.querySelector("[data-custom]") !== null);
    expect(container.querySelector("[data-vignette-layer='bg'] section")).not.toBeNull();
    await target.dispose();
  });

  it("hears a source only while the shown scene places it, at its channel's volume", async () => {
    // jsdom has no Web Audio, so each element plays by itself: the mixer's fallback.
    const container = mount();
    const target = domTarget(container, { sources: [tone] });
    target.apply(setup());
    target.apply(soundSnapshot(1, "main", { volumeDb: -6 }));
    await target.settled(1);
    await waitFor(() => elements.size === 2);
    const voice = elements.get("voice");
    const bed = elements.get("bed");
    expect(voice?.muted).toBe(false);
    expect(voice?.volume).toBeCloseTo(0.5, 2);
    // The bed has no picture: it is heard while its scene lists it, and never laid out.
    expect(bed?.muted).toBe(false);
    expect(container.querySelector("[data-vignette-layer] audio")).toBe(voice);
    expect(target.status.audio).toEqual({
      state: "unavailable",
      // A page in an iframe plays as it is: only what its channel changes is out of reach.
      unsupported: { chat: ["volumeDb"] },
      mix: [],
    });

    target.apply(soundSnapshot(2, "brb", { volumeDb: -6 }));
    await target.settled(2);
    expect(voice?.muted).toBe(true);
    expect(bed?.muted).toBe(true);

    target.apply(soundSnapshot(3, "main", { muted: true }));
    await target.settled(3);
    expect(voice?.muted).toBe(true);
    expect(bed?.muted).toBe(false);
    await target.dispose();
    elements.clear();
  });

  it("lays a delay line over a picture whose audio leads it, and removes it at zero", async () => {
    // jsdom has no VideoFrame; a stand-in lets the delay line start.
    vi.stubGlobal("VideoFrame", FakeVideoFrame);
    try {
      const container = mount();
      const target = domTarget(container, { sources: [camera] });
      target.apply(setup());
      target.apply(cameraSnapshot(1, -400));
      await target.settled(1);
      await waitFor(() => container.querySelector("[data-vignette-delay-line]") !== null);
      const content = container.querySelector("[data-vignette-layer='main.cam'] > div");
      const line = container.querySelector<HTMLCanvasElement>("[data-vignette-delay-line]");
      // Over the camera's own canvas, at its placement, hidden until it holds 400 ms of frames.
      expect(line?.parentElement).toBe(content);
      expect(content?.lastElementChild).toBe(line);
      expect(line?.style).toMatchObject({ width: "1280px", height: "720px", visibility: "hidden" });

      target.apply(cameraSnapshot(2, 0));
      await target.settled(2);
      expect(container.querySelector("[data-vignette-delay-line]")).toBeNull();
      expect(content?.querySelector("canvas[data-camera]")).not.toBeNull();
      await target.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports missing plugins without builtins and renders nothing", async () => {
    const container = mount();
    const target = domTarget(container, { builtins: false });
    target.apply(setup());
    target.apply(showSnapshot(1, "main"));
    await expect(target.settled(1)).rejects.toThrow('missing source plugin for kind "color"');
    expect(target.status.phase).toBe("error");
    expect(target.status.error?.message).toContain('missing source plugin for kind "browser"');
    expect(container.querySelector("[data-vignette-layer]")).toBeNull();
    await target.dispose();
  });
});

/** The `<audio>` each `tone` source plays, by source ID. */
const elements = new Map<string, HTMLAudioElement>();

/** A sound with no picture of its own, played by an `<audio>` through the target's mixer. */
const tone: DomSourcePlugin = {
  kind: "tone",
  create(source, { document }) {
    const audio = document.createElement("audio");
    audio.muted = true;
    elements.set(source.id, audio);
    return { element: audio, media: { audio } };
  },
};

/** `voice` placed in `main`, `bed` heard in `main` without a picture, and a silent `chat`. */
function soundSnapshot(
  revision: number,
  activeScene: string,
  voice: AudioChannelInput,
): StreamMessage {
  const sound = { kind: "tone", props: {}, size: { width: 640, height: 360 } };
  const snapshot: Snapshot = {
    revision,
    id: "show",
    canvas: { width: 1920, height: 1080 },
    activeScene,
    sources: [
      { id: "voice", ...sound, audio: AudioChannelSchema.parse(voice) },
      { id: "bed", ...sound, audio: AudioChannelSchema.parse({}) },
      { ...chat, audio: AudioChannelSchema.parse({ volumeDb: -10 }) },
    ],
    scenes: [
      {
        id: "main",
        items: [item("main.voice", "voice", 0, 640), item("main.chat", "chat", 640, 640)],
        audio: ["bed"],
      },
      { id: "brb", items: [] },
    ],
  };
  return { kind: "update", snapshot };
}

/** A picture drawn into a canvas, which a negative sync offset delays. */
const camera: DomSourcePlugin = {
  kind: "camera",
  create(_source, { document }) {
    const canvas = document.createElement("canvas");
    canvas.dataset.camera = "";
    canvas.width = 4;
    canvas.height = 4;
    return { element: canvas, media: { video: canvas } };
  },
};

function cameraSnapshot(revision: number, syncOffsetMs: number): StreamMessage {
  const snapshot: Snapshot = {
    revision,
    id: "show",
    canvas: { width: 1920, height: 1080 },
    sources: [
      {
        id: "cam",
        kind: "camera",
        props: {},
        size: { width: 1280, height: 720 },
        audio: AudioChannelSchema.parse({ syncOffsetMs }),
      },
    ],
    scenes: [{ id: "main", items: [item("main.cam", "cam", 0, 1280)] }],
  };
  return { kind: "update", snapshot };
}

/** Enough of `VideoFrame` for the delay line to hold frames. */
class FakeVideoFrame {
  readonly displayWidth = 4;
  readonly displayHeight = 4;
  close(): void {
    // Nothing is held.
  }
}

/** Polls a condition across macrotasks, for handles that resolve asynchronously. */
async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Condition was not met.");
}
