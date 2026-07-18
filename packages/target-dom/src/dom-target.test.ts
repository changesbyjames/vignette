// @vitest-environment jsdom

import { compileBroadcast, type AssetResolver } from "@strangecyan/vignette-core";
import {
  broadcast,
  browserSource,
  colorSource,
  layer,
  mediaSource,
  scene,
  sources,
} from "@strangecyan/vignette-core/builders";
import { yogaLayoutEngine } from "@strangecyan/vignette-core/layout-yoga";
import { describe, expect, it, vi } from "vitest";

import { DomTarget } from "./dom-target.js";

describe("DomTarget", () => {
  it("materializes and settles a fixed-canvas scene", async () => {
    const graph = broadcast({
      projectId: "demo",
      children: [
        sources(colorSource({ id: "background", color: "#102030" })),
        scene({
          id: "programme",
          children: [
            layer({
              id: "programme.background",
              sourceId: "background",
              style: { width: "100%", height: "100%" },
            }),
          ],
        }),
      ],
    });
    const compiled = compileBroadcast(graph, { revision: 1, layoutEngine: yogaLayoutEngine });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const container = document.createElement("div");
    const assetResolver: AssetResolver = {
      resolve: () => Promise.reject(new Error("No assets expected.")),
    };
    const target = new DomTarget({ container, sceneId: "programme", assetResolver });
    target.publish(compiled.snapshot);
    await target.whenSettled(1);

    expect(
      container.querySelector("[data-vignette-stage]")?.getAttribute("data-vignette-revision"),
    ).toBe("1");
    expect(container.querySelector("[data-vignette-layer='programme.background']")).not.toBeNull();
    expect(target.getStatus()).toMatchObject({ phase: "settled", settledRevision: 1 });

    await target.dispose();
    expect(container.childElementCount).toBe(0);
  });

  it("keeps one browser element alive while switching scenes", async () => {
    const graph = broadcast({
      projectId: "demo",
      children: [
        sources(
          browserSource({
            id: "browser",
            url: "https://example.com/",
            viewport: { width: 1280, height: 720 },
          }),
        ),
        scene({
          id: "programme",
          children: [
            layer({
              id: "programme.browser",
              sourceId: "browser",
              style: { width: 1280, height: 720 },
            }),
          ],
        }),
        scene({
          id: "preview",
          children: [
            layer({
              id: "preview.browser",
              sourceId: "browser",
              style: { width: 1280, height: 720 },
            }),
          ],
        }),
      ],
    });
    const compiled = compileBroadcast(graph, { revision: 1, layoutEngine: yogaLayoutEngine });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const container = document.createElement("div");
    document.body.append(container);
    const target = new DomTarget({
      container,
      sceneId: "programme",
      assetResolver: unexpectedAssetResolver(),
    });
    target.publish(compiled.snapshot);
    await target.whenSettled(1);

    const initialFrame = container.querySelector<HTMLIFrameElement>(
      "[data-vignette-layer='programme.browser'] iframe",
    );
    expect(initialFrame).not.toBeNull();

    await target.setScene("preview");

    const movedFrame = container.querySelector<HTMLIFrameElement>(
      "[data-vignette-layer='preview.browser'] iframe",
    );
    expect(movedFrame).toBe(initialFrame);
    expect(container.querySelector("[data-vignette-layer='programme.browser']")).toBeNull();

    await target.dispose();
  });

  it("retains a temporarily unplaced browser element", async () => {
    const graph = broadcast({
      projectId: "demo",
      children: [
        sources(
          browserSource({
            id: "browser",
            url: "https://example.com/",
            viewport: { width: 1280, height: 720 },
          }),
        ),
        scene({
          id: "programme",
          children: [
            layer({
              id: "programme.browser",
              sourceId: "browser",
              style: { width: 1280, height: 720 },
            }),
          ],
        }),
      ],
    });
    const compiled = compileBroadcast(graph, { revision: 1, layoutEngine: yogaLayoutEngine });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const container = document.createElement("div");
    document.body.append(container);
    const target = new DomTarget({
      container,
      sceneId: "programme",
      assetResolver: unexpectedAssetResolver(),
    });
    target.publish(compiled.snapshot);
    await target.whenSettled(1);
    const initialFrame = container.querySelector("iframe");

    const [programme] = compiled.snapshot.scenes;
    if (programme === undefined) throw new Error("Fixture scene is missing.");
    target.publish({
      ...compiled.snapshot,
      revision: 2,
      scenes: [{ ...programme, items: [] }],
    });
    await target.whenSettled(2);
    expect(container.querySelector("[data-vignette-layer]")).toBeNull();

    target.publish({ ...compiled.snapshot, revision: 3 });
    await target.whenSettled(3);
    expect(container.querySelector("iframe")).toBe(initialFrame);

    await target.dispose();
  });

  it("restarts retained media when it enters another active scene", async () => {
    const graph = broadcast({
      projectId: "demo",
      children: [
        sources(mediaSource({ id: "clip", asset: { kind: "asset", name: "clip" } })),
        scene({
          id: "programme",
          children: [
            layer({
              id: "programme.clip",
              sourceId: "clip",
              style: { width: 1280, height: 720 },
            }),
          ],
        }),
        scene({
          id: "preview",
          children: [
            layer({
              id: "preview.clip",
              sourceId: "clip",
              style: { width: 1280, height: 720 },
            }),
          ],
        }),
      ],
    });
    const compiled = compileBroadcast(graph, { revision: 1, layoutEngine: yogaLayoutEngine });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const target = new DomTarget({
      container,
      sceneId: "programme",
      assetResolver: {
        resolve: () => Promise.resolve({ kind: "url", url: "https://example.com/clip.mp4" }),
      },
    });
    target.publish(compiled.snapshot);
    await target.whenSettled(1);

    const initialVideo = container.querySelector<HTMLVideoElement>("video");
    expect(initialVideo).not.toBeNull();
    if (initialVideo === null) return;
    expect(play).toHaveBeenCalledTimes(1);

    initialVideo.currentTime = 12;
    target.publish({ ...compiled.snapshot, revision: 2 });
    await target.whenSettled(2);
    expect(initialVideo.currentTime).toBe(12);
    expect(play).toHaveBeenCalledTimes(1);

    await target.setScene("preview");
    const movedVideo = container.querySelector<HTMLVideoElement>("video");
    expect(movedVideo).toBe(initialVideo);
    expect(initialVideo.currentTime).toBe(0);
    expect(play).toHaveBeenCalledTimes(2);

    await target.dispose();
  });

  it("can retain media playback position when it enters another active scene", async () => {
    const graph = broadcast({
      projectId: "demo",
      children: [
        sources(
          mediaSource({
            id: "clip",
            asset: { kind: "asset", name: "clip" },
            restartOnActivate: false,
          }),
        ),
        scene({
          id: "programme",
          children: [
            layer({
              id: "programme.clip",
              sourceId: "clip",
              style: { width: 1280, height: 720 },
            }),
          ],
        }),
        scene({
          id: "preview",
          children: [
            layer({
              id: "preview.clip",
              sourceId: "clip",
              style: { width: 1280, height: 720 },
            }),
          ],
        }),
      ],
    });
    const compiled = compileBroadcast(graph, { revision: 1, layoutEngine: yogaLayoutEngine });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const target = new DomTarget({
      container,
      sceneId: "programme",
      assetResolver: {
        resolve: () => Promise.resolve({ kind: "url", url: "https://example.com/clip.mp4" }),
      },
    });
    target.publish(compiled.snapshot);
    await target.whenSettled(1);

    const video = container.querySelector<HTMLVideoElement>("video");
    expect(video).not.toBeNull();
    if (video === null) return;
    video.currentTime = 12;

    await target.setScene("preview");
    expect(video.currentTime).toBe(12);
    expect(play).toHaveBeenCalledTimes(2);

    await target.dispose();
  });
});

function unexpectedAssetResolver(): AssetResolver {
  return { resolve: () => Promise.reject(new Error("No assets expected.")) };
}
