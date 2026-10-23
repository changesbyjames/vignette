import { describe, expect, it } from "vitest";

import {
  appendHostChild,
  clearHostChildren,
  createHostNode,
  hostTreeToBroadcast,
  insertHostChild,
  removeHostChild,
  updateHostNode,
} from "./host-tree.js";
import type { HostContainer } from "./host-types.js";

describe("host tree mutations", () => {
  it("appends, moves, reorders, inserts, and detaches without duplicate parents", () => {
    const container = makeContainer();
    const broadcast = createHostNode("broadcast", {});
    const first = createHostNode("box", {});
    const second = createHostNode("box", {});
    const nested = createHostNode("box", {});

    appendHostChild(container, broadcast);
    appendHostChild(broadcast, first);
    appendHostChild(broadcast, second);
    insertHostChild(broadcast, second, first);
    expect(broadcast.children).toEqual([second, first]);

    appendHostChild(first, nested);
    appendHostChild(second, nested);
    expect(first.children).toEqual([]);
    expect(second.children).toEqual([nested]);
    expect(nested.parent).toBe(second);

    appendHostChild(broadcast, second);
    expect(broadcast.children).toEqual([first, second]);
    expect(new Set(broadcast.children).size).toBe(2);

    removeHostChild(broadcast, first);
    expect(first.parent).toBeNull();
    expect(() => {
      removeHostChild(broadcast, first);
    }).toThrow(/non-parent/u);

    clearHostChildren(broadcast);
    expect(second.parent).toBeNull();
    expect(broadcast.children).toEqual([]);
  });

  it("rejects invalid insertion references, self-parenting, and ancestor cycles", () => {
    const parent = createHostNode("box", {});
    const child = createHostNode("box", {});
    const unrelated = createHostNode("box", {});
    appendHostChild(parent, child);

    expect(() => {
      appendHostChild(parent, parent);
    }).toThrow(/itself/u);
    expect(() => {
      appendHostChild(child, parent);
    }).toThrow(/ancestors/u);
    expect(() => {
      insertHostChild(parent, unrelated, unrelated);
    }).toThrow(/reference/u);
  });

  it("sanitizes props, updates them, and converts the committed tree", () => {
    const container = makeContainer();
    const broadcast = createHostNode("broadcast", { children: "ignored", key: "react-key" });
    const sources = createHostNode("sources", {});
    const color = createHostNode("source", {
      definition: { kind: "source:color", id: "background", color: "#123456" },
      children: "ignored",
      ref: "ignored",
      label: undefined,
    });
    const scene = createHostNode("scene", { id: "main" });
    const layer = createHostNode("layer", {
      id: "background-layer",
      sourceId: "background",
      style: { width: "100%", height: "100%" },
    });
    appendHostChild(container, broadcast);
    appendHostChild(broadcast, sources);
    appendHostChild(sources, color);
    appendHostChild(broadcast, scene);
    appendHostChild(scene, layer);

    expect(broadcast.props).toEqual({});
    expect(color.props).not.toHaveProperty("children");
    updateHostNode(color, {
      definition: { kind: "source:color", id: "background", color: "#abcdef" },
      key: "ignored",
    });

    expect(hostTreeToBroadcast(container)).toEqual({
      kind: "broadcast",
      projectId: "show",
      canvas: { width: 1920, height: 1080 },
      children: [
        {
          kind: "sources",
          children: [{ kind: "source:color", id: "background", color: "#abcdef" }],
        },
        {
          kind: "scene",
          id: "main",
          children: [
            {
              kind: "layer",
              id: "background-layer",
              sourceId: "background",
              style: { width: "100%", height: "100%" },
            },
          ],
        },
      ],
    });
  });

  it("lowers an embedded browser view to a neutral source and layer", () => {
    const container = makeContainer();
    const broadcast = createHostNode("broadcast", {});
    const scene = createHostNode("scene", { id: "main" });
    const view = createHostNode("browser-view", {
      id: "scoreboard-layer",
      sourceId: "scoreboard-source",
      url: "http://127.0.0.1:4173/__vignette/frame/scoreboard",
      viewport: { width: 1280, height: 720 },
      style: { width: 640, height: 360 },
      fit: "contain",
    });
    appendHostChild(container, broadcast);
    appendHostChild(broadcast, scene);
    appendHostChild(scene, view);

    expect(hostTreeToBroadcast(container)).toEqual({
      kind: "broadcast",
      projectId: "show",
      canvas: { width: 1920, height: 1080 },
      children: [
        {
          kind: "sources",
          children: [
            {
              kind: "source:browser",
              id: "scoreboard-source",
              url: "http://127.0.0.1:4173/__vignette/frame/scoreboard",
              viewport: { width: 1280, height: 720 },
            },
          ],
        },
        {
          kind: "scene",
          id: "main",
          children: [
            {
              kind: "layer",
              id: "scoreboard-layer",
              sourceId: "scoreboard-source",
              style: { width: 640, height: 360 },
              fit: "contain",
            },
          ],
        },
      ],
    });
  });

  it("keeps hidden subtrees and compiles their layers invisible", () => {
    const container = makeContainer();
    const broadcast = createHostNode("broadcast", {});
    const sources = createHostNode("sources", {});
    const color = createHostNode("source", {
      definition: { kind: "source:color", id: "next-background", color: "#123456" },
    });
    const scene = createHostNode("scene", { id: "next" });
    const box = createHostNode("box", { style: { width: "100%", height: "100%" } });
    const layer = createHostNode("layer", {
      id: "next-background-layer",
      sourceId: "next-background",
      visible: true,
    });
    const view = createHostNode("browser-view", {
      id: "next-view",
      sourceId: "next-view-source",
      url: "/__vignette/frame/next",
    });
    const nested = createHostNode("scene-layer", { id: "next-nested", sceneId: "other" });
    appendHostChild(container, broadcast);
    appendHostChild(broadcast, sources);
    appendHostChild(sources, color);
    appendHostChild(broadcast, scene);
    appendHostChild(scene, box);
    appendHostChild(box, layer);
    appendHostChild(box, view);
    appendHostChild(box, nested);
    sources.hidden = true;
    box.hidden = true;

    expect(hostTreeToBroadcast(container)).toEqual({
      kind: "broadcast",
      projectId: "show",
      canvas: { width: 1920, height: 1080 },
      children: [
        {
          kind: "sources",
          children: [
            { kind: "source:color", id: "next-background", color: "#123456" },
            { kind: "source:browser", id: "next-view-source", url: "/__vignette/frame/next" },
          ],
        },
        {
          kind: "scene",
          id: "next",
          children: [
            {
              kind: "box",
              style: { width: "100%", height: "100%" },
              children: [
                {
                  kind: "layer",
                  id: "next-background-layer",
                  sourceId: "next-background",
                  visible: false,
                },
                {
                  kind: "layer",
                  id: "next-view",
                  sourceId: "next-view-source",
                  visible: false,
                },
                { kind: "scene-layer", id: "next-nested", sceneId: "other", visible: false },
              ],
            },
          ],
        },
      ],
    });

    box.hidden = false;
    const scenes = hostTreeToBroadcast(container).children.filter(
      (child) => child.kind === "scene",
    );
    expect(scenes).toEqual([
      {
        kind: "scene",
        id: "next",
        children: [
          {
            kind: "box",
            style: { width: "100%", height: "100%" },
            children: [
              {
                kind: "layer",
                id: "next-background-layer",
                sourceId: "next-background",
                visible: true,
              },
              { kind: "layer", id: "next-view", sourceId: "next-view-source" },
              { kind: "scene-layer", id: "next-nested", sceneId: "other" },
            ],
          },
        ],
      },
    ]);
  });

  it("hides every layer of a hidden scene", () => {
    const container = makeContainer();
    const broadcast = createHostNode("broadcast", {});
    const scene = createHostNode("scene", { id: "next" });
    const layer = createHostNode("layer", { id: "next-layer", sourceId: "background" });
    appendHostChild(container, broadcast);
    appendHostChild(broadcast, scene);
    appendHostChild(scene, layer);
    scene.hidden = true;

    expect(hostTreeToBroadcast(container).children).toEqual([
      {
        kind: "scene",
        id: "next",
        children: [{ kind: "layer", id: "next-layer", sourceId: "background", visible: false }],
      },
    ]);
  });

  it("counts hidden broadcast nodes when requiring exactly one root", () => {
    const container = makeContainer();
    const visible = createHostNode("broadcast", {});
    const hidden = createHostNode("broadcast", {});
    appendHostChild(container, visible);
    appendHostChild(container, hidden);
    hidden.hidden = true;

    expect(() => hostTreeToBroadcast(container)).toThrow(
      "The renderer root must contain exactly one <Broadcast> node.",
    );
  });

  it("rejects source nodes without a complete definition", () => {
    const container = makeContainer();
    const broadcast = createHostNode("broadcast", {});
    const sources = createHostNode("sources", {});
    const invalid = createHostNode("source", { definition: { id: "live" } });
    appendHostChild(container, broadcast);
    appendHostChild(broadcast, sources);
    appendHostChild(sources, invalid);

    expect(() => hostTreeToBroadcast(container)).toThrow(/must declare 'kind' and 'id'/u);
  });
});

function makeContainer(): HostContainer {
  return {
    projectId: "show",
    canvas: { width: 1920, height: 1080 },
    children: [],
    commitRevision: 0,
    commitActive: false,
    onCommit: () => undefined,
  };
}
