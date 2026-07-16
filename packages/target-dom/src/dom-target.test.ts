// @vitest-environment jsdom

import { compileBroadcast, type AssetResolver } from "@cbj/vignette-core";
import {
  broadcast,
  browserSource,
  colorSource,
  layer,
  scene,
  sources,
} from "@cbj/vignette-core/builders";
import { describe, expect, it } from "vitest";

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
    const compiled = compileBroadcast(graph, { revision: 1 });
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
    const compiled = compileBroadcast(graph, { revision: 1 });
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
    const compiled = compileBroadcast(graph, { revision: 1 });
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
});

function unexpectedAssetResolver(): AssetResolver {
  return { resolve: () => Promise.reject(new Error("No assets expected.")) };
}
