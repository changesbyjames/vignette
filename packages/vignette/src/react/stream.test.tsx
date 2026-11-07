// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, Component, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Item, Snapshot, Source } from "../core/snapshot.js";
import type { Color } from "../core/sources/color.js";
import { createAsyncQueue, type AsyncQueue } from "../stream/async-queue.js";
import type { SetupMessage, ShowEvent, StreamMessage } from "../stream/messages.js";
import { encodeStreamMessageSse } from "../stream/sse-codec.js";
import type { TargetStatus } from "../target/status.js";
import { useStreamEvents, useStreamStatus } from "./hooks.js";
import type { ReactSourcePlugin } from "./plugin.js";
import { Stage } from "./stage.js";
import { Stream, type StreamProps } from "./stream.js";

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
  vi.unstubAllGlobals();
});

function setup(): SetupMessage {
  return {
    kind: "setup",
    id: "show",
    canvas: { width: 1920, height: 1080 },
    assets: { version: "v1", entries: [] },
    serve: {},
  };
}

function item(id: string, sourceId: string, x: number): Item {
  const frame = { x, y: 20, width: 640, height: 360 };
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

function color(id: string, value: string): Source {
  return { id, kind: "color", props: { color: value }, size: { width: 640, height: 360 } };
}

function update(
  revision: number,
  sources: readonly Source[],
  items: readonly Item[],
): StreamMessage {
  const snapshot: Snapshot = {
    revision,
    id: "show",
    canvas: { width: 1920, height: 1080 },
    sources,
    scenes: [
      { id: "main", items },
      { id: "side", items: items.slice(0, 1) },
    ],
  };
  return { kind: "update", snapshot };
}

/** Captures the latest stream status for assertions. */
const statuses: TargetStatus[] = [];
function StatusProbe(): ReactNode {
  statuses.push(useStreamStatus());
  return null;
}
function lastStatus(): TargetStatus | undefined {
  return statuses.at(-1);
}

function render(ui: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const client = new QueryClient();
  act(() => {
    root.render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  });
  return container;
}

/** Lets the kernel drain its effects and React commit. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 10; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function stream(
  props: Omit<StreamProps, "source">,
  children: ReactNode,
): [HTMLElement, AsyncQueue<StreamMessage>] {
  const queue = createAsyncQueue<StreamMessage>();
  statuses.length = 0;
  const container = render(
    <Stream {...props} source={queue}>
      {children}
      <StatusProbe />
    </Stream>,
  );
  return [container, queue];
}

/** A stream server stand-in: `fetch` answers with SSE the test writes message by message. */
function stubSse(): (message: StreamMessage) => void {
  const encoder = new TextEncoder();
  let push: (message: StreamMessage) => void = () => undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (message) => {
        controller.enqueue(encoder.encode(encodeStreamMessageSse(message)));
      };
    },
  });
  const response = new Response(body, { headers: { "content-type": "text/event-stream" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(response)),
  );
  return (message) => {
    push(message);
  };
}

function layer(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-vignette-layer="${id}"]`);
}

interface BoundaryProps {
  readonly children: ReactNode;
}
interface BoundaryState {
  readonly error?: Error;
}

describe("<Stream> and <Stage>", () => {
  it("renders the scene's items at their compiled frames", async () => {
    // Each item is positioned from its frame; the color view fills the source box.
    const [container, queue] = stream({}, <Stage scene="main" />);
    queue.push(setup());
    queue.push(
      update(
        1,
        [color("a", "#ff0000"), color("b", "#00ff00")],
        [item("a", "a", 0), item("b", "b", 700)],
      ),
    );
    await settle();

    const first = layer(container, "a");
    const second = layer(container, "b");
    expect(first?.style.left).toBe("0px");
    expect(second?.style.left).toBe("700px");
    expect(second?.style.width).toBe("640px");
    expect(second?.style.opacity).toBe("0.5");
    expect(
      second?.querySelector<HTMLElement>("[data-vignette-source=b] div")?.style.background,
    ).toBe("rgb(0, 255, 0)");
  });

  it("renders two stages of different scenes under one stream", async () => {
    const [container, queue] = stream(
      {},
      <>
        <Stage scene="main" className="one" />
        <Stage scene="side" className="two" />
      </>,
    );
    queue.push(setup());
    queue.push(
      update(
        1,
        [color("a", "#ff0000"), color("b", "#00ff00")],
        [item("a", "a", 0), item("b", "b", 700)],
      ),
    );
    await settle();

    const one = container.querySelector<HTMLElement>(".one");
    const two = container.querySelector<HTMLElement>(".two");
    expect(one?.querySelectorAll("[data-vignette-layer]")).toHaveLength(2);
    expect(two?.querySelectorAll("[data-vignette-layer]")).toHaveLength(1);
    expect(two?.dataset.vignetteStage).toBe("side");
  });

  it("reports the SSE connection and the target's phase and revisions", async () => {
    // Connecting until the first message, then the kernel's own status with the connection.
    const send = stubSse();
    statuses.length = 0;
    render(
      <Stream url="http://show.test/stream">
        <Stage />
        <StatusProbe />
      </Stream>,
    );
    expect(lastStatus()?.phase).toBe("connecting");

    send(setup());
    send(update(3, [color("a", "#ff0000")], [item("a", "a", 0)]));
    await settle();
    expect(lastStatus()).toMatchObject({
      phase: "settled",
      revision: { desired: 3, settled: 3 },
      connection: { phase: "open" },
      sources: { a: "live" },
    });
  });

  it("reports a failed stream as an error", async () => {
    const [, queue] = stream({}, <Stage />);
    queue.fail(new Error("socket reset"));
    await settle();
    expect(lastStatus()?.phase).toBe("error");
    expect(lastStatus()?.error?.message).toBe("socket reset");
  });

  it("reports a kind without a plugin and renders nothing", async () => {
    const [container, queue] = stream({}, <Stage />);
    const live: Source = { id: "m", kind: "moq", props: {}, size: { width: 640, height: 360 } };
    queue.push(setup());
    queue.push(update(1, [color("a", "#ff0000"), live], [item("a", "a", 0), item("m", "m", 700)]));
    await settle();

    expect(lastStatus()?.phase).toBe("error");
    expect(lastStatus()?.error?.message).toContain('missing source plugin for kind "moq"');
    expect(layer(container, "a")).toBeNull();
  });

  it("renders an empty box for a kind without a plugin with checkPlugins: false", async () => {
    // A preview page shows any show: the unknown source is an error, the rest renders.
    const [container, queue] = stream({ checkPlugins: false }, <Stage scene="main" />);
    const live: Source = { id: "m", kind: "moq", props: {}, size: { width: 640, height: 360 } };
    queue.push(setup());
    queue.push(update(1, [color("a", "#ff0000"), live], [item("a", "a", 0), item("m", "m", 700)]));
    await settle();

    expect(lastStatus()).toMatchObject({ phase: "settled", sources: { a: "live", m: "error" } });
    expect(layer(container, "a")?.querySelector("[data-vignette-source=a]")).not.toBeNull();
    expect(layer(container, "m")?.textContent).toBe("");
  });

  it("uses only the listed plugins with builtins: false", async () => {
    // The custom color view replaces the built-in; without any color plugin the kind is missing.
    const swatch: ReactSourcePlugin<typeof Color> = {
      kind: "color",
      View: ({ source }) => <span className="swatch">{source.props.color}</span>,
    };
    const [container, queue] = stream({ builtins: false, sources: [swatch] }, <Stage />);
    queue.push(setup());
    queue.push(update(1, [color("a", "#ff0000")], [item("a", "a", 0)]));
    await settle();
    expect(container.querySelector(".swatch")?.textContent).toBe("#ff0000");

    const [, bare] = stream({ builtins: false }, <Stage />);
    bare.push(setup());
    bare.push(update(1, [color("a", "#ff0000")], [item("a", "a", 0)]));
    await settle();
    expect(lastStatus()?.error?.message).toContain('missing source plugin for kind "color"');
  });

  it("renders frames as iframes of the frame page that params never reload", async () => {
    // The view knows no frame components: it opens the page the setup's `serve` locates.
    const [container, queue] = stream({}, <Stage scene="main" />);
    const score = (home: number): Source => ({
      id: "s",
      kind: "frame",
      props: { frame: "Score", params: { home } },
      size: { width: 400, height: 120 },
    });
    queue.push({
      ...setup(),
      serve: { stream: "http://show.test/stream", frames: "http://show.test/frames.html" },
    });
    queue.push(update(1, [score(1)], [item("s", "s", 0)]));
    await settle();
    const page = layer(container, "s")?.querySelector("iframe");
    expect(page?.getAttribute("src")).toBe(
      "http://show.test/frames.html?frame=Score&source=s&stream=http%3A%2F%2Fshow.test%2Fstream%3Fsource%3Ds",
    );

    queue.push(update(2, [score(2)], [item("s", "s", 0)]));
    await settle();
    expect(layer(container, "s")?.querySelector("iframe")).toBe(page);
    expect(page?.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
  });

  it("delivers show events to useStreamEvents", async () => {
    const received: ShowEvent[] = [];
    function Listener(): ReactNode {
      useStreamEvents((event) => {
        received.push(event);
      });
      return null;
    }
    const [, queue] = stream({}, <Listener />);
    queue.push(setup());
    queue.push({ kind: "event", event: { kind: "media:restart", sourceId: "intro" } });
    await settle();
    expect(received).toEqual([{ kind: "media:restart", sourceId: "intro" }]);
  });

  it("throws a clear error without a QueryClientProvider", () => {
    const errors: string[] = [];
    class Boundary extends Component<BoundaryProps, BoundaryState> {
      override state: BoundaryState = {};
      static getDerivedStateFromError(error: Error): BoundaryState {
        return { error };
      }
      override render(): ReactNode {
        if (this.state.error !== undefined) errors.push(this.state.error.message);
        return this.state.error === undefined ? this.props.children : null;
      }
    }
    const container = document.createElement("div");
    const root = createRoot(container, { onCaughtError: () => undefined });
    roots.push(root);
    act(() => {
      root.render(
        <Boundary>
          <Stream source={createAsyncQueue<StreamMessage>()} />
        </Boundary>,
      );
    });
    expect(errors[0]).toContain("QueryClientProvider");
  });
});
