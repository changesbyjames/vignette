// @vitest-environment jsdom

import { compileBroadcast } from "@cbj/react-obs-core";
import { broadcast, colorSource, layer, scene, sources } from "@cbj/react-obs-core/builders";
import { describe, expect, it } from "vitest";

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
      { revision: 1 },
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

    await runtime.setup({ version: 1, assets: [] });
    runtime.update(compiled.snapshot);
    await runtime.whenSettled(1);

    expect(phases).toEqual(["synchronising", "settled"]);
    expect(getSnapshot()).toMatchObject({ phase: "settled", settledRevision: 1 });
    expect(getServerSnapshot()).toBe(serverSnapshot);

    await runtime.dispose();
    expect(phases.at(-1)).toBe("disposed");
    unsubscribe();
  });
});
