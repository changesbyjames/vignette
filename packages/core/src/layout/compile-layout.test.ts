import { describe, expect, it } from "vitest";

import { asset } from "../assets.js";
import {
  box,
  broadcast,
  browserSource,
  imageSource,
  layer,
  mediaSource,
  scene,
  sources,
} from "../builders.js";
import { compileBroadcast } from "./compile-layout.js";
import { yogaLayoutEngine } from "./layout-yoga.js";

describe("compileBroadcast", () => {
  it("flattens a Yoga tree into deterministic absolute items", () => {
    const graph = broadcast({
      projectId: "demo",
      children: [
        sources(
          imageSource({
            id: "background",
            asset: asset("background.png"),
            size: { width: 1920, height: 1080 },
          }),
          mediaSource({
            id: "video",
            asset: asset("video.mp4"),
            size: { width: 1920, height: 1080 },
          }),
          browserSource({
            id: "web",
            url: "https://example.test/graphic",
            viewport: { width: 800, height: 450 },
          }),
        ),
        scene({
          id: "programme",
          children: [
            box({
              style: {
                width: "100%",
                height: "100%",
                flexDirection: "row",
                padding: 48,
                gap: 32,
              },
              children: [
                layer({
                  id: "programme.background",
                  sourceId: "background",
                  style: { position: "absolute", inset: 0 },
                  fit: "cover",
                }),
                layer({
                  id: "programme.video",
                  sourceId: "video",
                  style: { flexGrow: 1 },
                  fit: "cover",
                }),
                layer({
                  id: "programme.web",
                  sourceId: "web",
                  style: { flexGrow: 1 },
                  fit: "contain",
                }),
              ],
            }),
          ],
        }),
      ],
    });

    const result = compileBroadcast(graph, { revision: 7, layoutEngine: yogaLayoutEngine });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.snapshot.scenes[0]?.items.map(({ id, frame }) => ({ id, frame }))).toEqual([
      {
        id: "programme.background",
        frame: { x: 0, y: 0, width: 1920, height: 1080 },
      },
      { id: "programme.video", frame: { x: 48, y: 48, width: 896, height: 984 } },
      { id: "programme.web", frame: { x: 976, y: 48, width: 896, height: 984 } },
    ]);
    const repeated = compileBroadcast(graph, { revision: 7, layoutEngine: yogaLayoutEngine });
    expect(repeated.ok).toBe(true);
    if (repeated.ok)
      expect(JSON.stringify(result.snapshot)).toBe(JSON.stringify(repeated.snapshot));
  });
});
