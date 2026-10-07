// @vitest-environment jsdom

import { compileBroadcast } from "@strangecyan/vignette-core";
import { broadcast, colorSource, layer, scene, sources } from "@strangecyan/vignette-core/builders";
import { yogaLayoutEngine } from "@strangecyan/vignette-core/layout-yoga";
import { describe, expect, it, vi } from "vitest";

import { DOMRuntime } from "./runtime.js";

describe("DOMRuntime external store", () => {
  it("provides stable extractable methods and cached status snapshots", async () => {
    const compiled = compileBroadcast(
      broadcast({
        projectId: "external-store",
        children: [
          sources(colorSource({ id: "background", color: "#123456" })),
          scene({
            id: "main",
            children: [
              layer({
                id: "background-layer",
                sourceId: "background",
                style: { width: "100%", height: "100%" },
              }),
            ],
          }),
        ],
      }),
      { revision: 1, layoutEngine: yogaLayoutEngine },
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const runtime = new DOMRuntime({ container: document.createElement("div"), sceneId: "main" });
    const { subscribe, getSnapshot, getServerSnapshot } = runtime;
    const serverSnapshot = getServerSnapshot();
    expect(serverSnapshot).toBe(getServerSnapshot());
    expect(getSnapshot()).toBe(getSnapshot());
    const phases: string[] = [];
    const unsubscribe = subscribe(() => phases.push(getSnapshot().phase));

    await runtime.setup({
      projectId: "external-store",
      manifest: { version: 1, assets: [] },
      extensions: [],
    });
    runtime.update(compiled.snapshot);
    await runtime.whenSettled(1);

    expect(phases).toEqual(["synchronising", "settled"]);
    expect(getSnapshot()).toMatchObject({ phase: "settled", settledRevision: 1 });
    expect(getServerSnapshot()).toBe(serverSnapshot);

    await runtime.dispose();
    expect(phases.at(-1)).toBe("disposed");
    unsubscribe();
  });

  it("enters an actionable error state when the stream needs an unregistered extension", async () => {
    const onError = vi.fn<(error: Error) => void>();
    const runtime = new DOMRuntime({
      container: document.createElement("div"),
      sceneId: "main",
      onError,
    });
    const phases: string[] = [];
    const unsubscribe = runtime.subscribe(() => phases.push(runtime.getSnapshot().phase));

    await runtime.setup({
      projectId: "extension-check",
      manifest: { version: 1, assets: [] },
      extensions: [{ kind: "source:moq", entrypoints: { dom: "@strangecyan/vignette-moq/dom" } }],
    });

    const message =
      "Stream requires source kind 'source:moq'; register @strangecyan/vignette-moq/dom.";
    expect(runtime.getSnapshot()).toEqual({ targetId: "dom", phase: "error", message });
    expect(onError).toHaveBeenCalledWith(new Error(message));
    expect(phases).toEqual(["error"]);
    expect(() => {
      runtime.update({
        revision: 1,
        projectId: "extension-check",
        canvas: { width: 1920, height: 1080 },
        sources: [],
        scenes: [],
        warnings: [],
      });
    }).not.toThrow();
    expect(runtime.getSnapshot().phase).toBe("error");

    unsubscribe();
    await runtime.dispose();
  });
});
