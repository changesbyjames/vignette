import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { isGroupNode, type LayoutNode, type ShowTree } from "../core/show-tree.js";
import { Browser } from "../core/sources/browser.js";
import { Color } from "../core/sources/color.js";
import { Layer, Scene, Show, Use } from "./elements.js";
import type { HostContainer } from "./host-types.js";
import { lowerShow, type LoweredShow } from "./lower.js";
import { reconciler } from "./reconciler.js";

const canvas = { width: 1920, height: 1080 };

describe("lowerShow", () => {
  it("derives layer IDs from the tree path and gives inline sources their layer's ID", () => {
    const { tree, diagnostics } = lower(
      <Show id="weekly" canvas={canvas}>
        <Scene id="main">
          <Layer>
            <Color color="#000000" />
          </Layer>
          <Layer style={{ flexDirection: "row" }}>
            <Layer>
              <Browser url="https://example.com/a" />
            </Layer>
            <Layer>
              <Browser url="https://example.com/b" />
            </Layer>
          </Layer>
        </Scene>
      </Show>,
    );

    expect(diagnostics).toEqual([]);
    expect(layerIds(tree)).toEqual(["main.0", "main.1", "main.1.0", "main.1.1"]);
    expect(sourceIds(tree)).toEqual(["main.0", "main.1.0", "main.1.1"]);
  });

  it("keeps derived IDs when props change but the shape does not", () => {
    const render = (visible: boolean, url: string) => (
      <Show id="weekly" canvas={canvas}>
        <Scene id="main">
          <Layer style={{ flexDirection: visible ? "row" : "column" }}>
            <Layer visible={visible} opacity={visible ? 1 : 0.5}>
              <Browser url={url} />
            </Layer>
          </Layer>
        </Scene>
      </Show>
    );
    const container = createContainer();

    renderInto(container, render(true, "https://example.com/a"));
    const before = lowerShow(container);
    renderInto(container, render(false, "https://example.com/b"));
    const after = lowerShow(container);

    expect(layerIds(after.tree)).toEqual(layerIds(before.tree));
    expect(sourceIds(after.tree)).toEqual(sourceIds(before.tree));
    expect(sources(after.tree)[0]?.props).toMatchObject({ url: "https://example.com/b" });
  });

  it("keeps explicit IDs in lists as items are inserted, and qualifies their sources by scene", () => {
    const render = (guests: readonly string[]) => (
      <Show id="weekly" canvas={canvas}>
        <Scene id="main">
          {guests.map((guest) => (
            <Layer key={guest} id={`guest-${guest}`}>
              <Browser url={`https://example.com/${guest}`} />
            </Layer>
          ))}
        </Scene>
      </Show>
    );
    const container = createContainer();

    renderInto(container, render(["ada", "bo"]));
    expect(layerIds(lowerShow(container).tree)).toEqual(["guest-ada", "guest-bo"]);
    renderInto(container, render(["cy", "ada", "bo"]));
    const { tree } = lowerShow(container);

    expect(layerIds(tree)).toEqual(["guest-cy", "guest-ada", "guest-bo"]);
    expect(sourceIds(tree)).toEqual(["main.guest-cy", "main.guest-ada", "main.guest-bo"]);
  });

  it("derives IDs below an explicit layer from that layer", () => {
    const { tree } = lower(
      <Show id="weekly" canvas={canvas}>
        <Scene id="main">
          <Layer id="sidebar">
            <Layer>
              <Color color="#000000" />
            </Layer>
          </Layer>
        </Scene>
      </Show>,
    );

    expect(layerIds(tree)).toEqual(["sidebar", "sidebar.0"]);
    expect(sourceIds(tree)).toEqual(["main.sidebar.0"]);
  });

  it("lowers <Use> to a reference and sizes shared sources without a layer", () => {
    const { tree, diagnostics } = lower(
      <Show id="weekly" canvas={canvas}>
        <Browser id="chat" url="https://example.com/chat" />
        <Scene id="main">
          <Layer style={{ width: 480 }}>
            <Use source="chat" />
          </Layer>
        </Scene>
      </Show>,
    );

    expect(diagnostics).toEqual([]);
    expect(tree?.sharedSources).toEqual([
      {
        id: "chat",
        kind: "browser",
        props: { url: "https://example.com/chat", shutdownWhenHidden: false },
        size: canvas,
      },
    ]);
    expect(layers(tree)[0]).toMatchObject({ id: "main.0", source: { ref: "chat" } });
  });

  it("binds inline source size to the laid-out layer", () => {
    const { tree } = lower(
      <Show id="weekly" canvas={canvas}>
        <Scene id="main">
          <Layer>
            <Browser url="https://example.com" />
          </Layer>
        </Scene>
      </Show>,
    );

    expect(sources(tree)[0]?.size({ width: 400, height: 300 })).toEqual({
      width: 400,
      height: 300,
    });
  });

  it("rejects a layer that holds both a source and layers", () => {
    const { diagnostics } = lower(
      <Show id="weekly" canvas={canvas}>
        <Scene id="main">
          <Layer>
            <Color color="#000000" />
            <Layer />
          </Layer>
        </Scene>
      </Show>,
    );

    expect(diagnostics).toMatchObject([
      { code: "LAYER_HAS_BOTH", path: "scene.main.layer.main.0" },
    ]);
  });

  it("reports invalid layer and source props with their schema path", () => {
    const { diagnostics } = lower(
      <Show id="weekly" canvas={canvas}>
        <Scene id="main">
          <Layer style={{ gap: -1 }} opacity={2}>
            <Color color="blue" />
          </Layer>
        </Scene>
      </Show>,
    );

    expect(diagnostics.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: "INVALID_PROPS", path: "scene.main.layer.main.0.style.gap" },
      { code: "INVALID_PROPS", path: "scene.main.layer.main.0.opacity" },
      { code: "INVALID_PROPS", path: "scene.main.layer.main.0.source.props.color" },
    ]);
  });

  it("requires exactly one <Show> at the root and an id on shared sources", () => {
    expect(lower(<Scene id="main" />).diagnostics).toMatchObject([{ code: "INVALID_TREE" }]);
    expect(
      lower(
        <Show id="weekly" canvas={canvas}>
          <Color color="#000000" />
        </Show>,
      ).diagnostics,
    ).toMatchObject([{ code: "INVALID_SOURCE_ID", path: "show.source" }]);
  });
});

function createContainer(): HostContainer {
  return { children: [], commitRevision: 0, commitActive: false, onCommit: () => undefined };
}

// The reconciler root is opaque; it is only passed back to the same reconciler.
const roots = new WeakMap<HostContainer, unknown>();

function renderInto(container: HostContainer, element: ReactElement): void {
  let root = roots.get(container);
  if (root === undefined) {
    const created: unknown = reconciler.createContainer(
      container,
      1,
      null,
      false,
      null,
      "test-",
      (error) => {
        throw error;
      },
      () => undefined,
      () => undefined,
      () => undefined,
    );
    roots.set(container, created);
    root = created;
  }
  reconciler.updateContainerSync(element, root, null, null);
  reconciler.flushSyncWork();
}

function lower(element: ReactElement): LoweredShow {
  const container = createContainer();
  renderInto(container, element);
  return lowerShow(container);
}

function layers(tree: ShowTree | undefined): LayoutNode[] {
  const flatten = (node: LayoutNode): LayoutNode[] =>
    isGroupNode(node) ? [node, ...node.children.flatMap(flatten)] : [node];
  return (tree?.scenes ?? []).flatMap((scene) =>
    isGroupNode(scene.root) ? scene.root.children.flatMap(flatten) : [],
  );
}

function layerIds(tree: ShowTree | undefined): string[] {
  return layers(tree).map((layer) => layer.id);
}

function sources(tree: ShowTree | undefined) {
  return layers(tree).flatMap((layer) =>
    !isGroupNode(layer) && "id" in layer.source ? [layer.source] : [],
  );
}

function sourceIds(tree: ShowTree | undefined): string[] {
  return sources(tree).map((source) => source.id);
}
