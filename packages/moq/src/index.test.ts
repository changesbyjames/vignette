import { resolveSourceModules, validateBroadcast } from "@cbj/vignette-core";
import { broadcast, layer, scene, sources } from "@cbj/vignette-core/builders";
import { describe, expect, it } from "vitest";

import { moqSource, moqSourceModule } from "./index.js";

const modules = resolveSourceModules([moqSourceModule]);

describe("moqSourceModule", () => {
  it("accepts a well-formed MoQ source", () => {
    const graph = broadcast({
      projectId: "weekly-show",
      children: [
        sources(
          moqSource({
            id: "live",
            url: "https://cdn.moq.dev/demo",
            broadcast: "bbb.hang",
            size: { width: 1280, height: 720 },
            latencyMs: 100,
          }),
        ),
        scene({ id: "programme", children: [layer({ id: "live", sourceId: "live" })] }),
      ],
    });

    expect(validateBroadcast(graph, { modules })).toMatchObject({ valid: true, diagnostics: [] });
  });

  it("reports every invalid MoQ setting deterministically", () => {
    const graph = broadcast({
      projectId: "weekly-show",
      children: [
        sources(
          moqSource({
            id: "live",
            url: "not-a-url",
            broadcast: " ",
            size: { width: 0, height: 720 },
            latencyMs: 30_001,
            quality: "",
          }),
        ),
        scene({ id: "programme", children: [layer({ id: "live", sourceId: "live" })] }),
      ],
    });

    expect(validateBroadcast(graph, { modules }).diagnostics.map(({ path }) => path)).toEqual([
      "broadcast.children[0].children[0].broadcast",
      "broadcast.children[0].children[0].latencyMs",
      "broadcast.children[0].children[0].quality",
      "broadcast.children[0].children[0].size",
      "broadcast.children[0].children[0].url",
    ]);
  });

  it("is rejected by validation when the module is not registered", () => {
    const graph = broadcast({
      projectId: "weekly-show",
      children: [
        sources(
          moqSource({
            id: "live",
            url: "https://cdn.moq.dev/demo",
            broadcast: "bbb.hang",
            size: { width: 1280, height: 720 },
          }),
        ),
        scene({ id: "programme", children: [layer({ id: "live", sourceId: "live" })] }),
      ],
    });

    const result = validateBroadcast(graph);
    expect(result.errors.map(({ code }) => code)).toEqual(["UNKNOWN_SOURCE_KIND"]);
  });
});
