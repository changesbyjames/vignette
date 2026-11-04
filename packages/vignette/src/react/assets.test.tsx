// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, Component, Suspense, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssetEntry } from "../core/assets.js";
import type { Item, Snapshot } from "../core/snapshot.js";
import { createAsyncQueue } from "../stream/async-queue.js";
import type { StreamMessage } from "../stream/messages.js";
import { useAsset } from "./assets.js";
import { Stage } from "./stage.js";
import { Stream } from "./stream.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LOGO = new TextEncoder().encode("logo bytes");

const roots: Root[] = [];
beforeEach(() => {
  let next = 0;
  vi.stubGlobal(
    "URL",
    Object.assign(class extends URL {}, {
      createObjectURL: vi.fn(() => `blob:asset-${String(next++)}`),
      revokeObjectURL: vi.fn(),
    }),
  );
});
afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<AssetEntry["hash"]> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `sha256-${btoa(String.fromCharCode(...digest))}`;
}

/** Serves `bytes` for every request, after `gate` resolves. */
function serve(bytes: Uint8Array<ArrayBuffer>, gate: Promise<void>) {
  const fetch = vi.fn(async (_input: URL) => {
    await gate;
    return new Response(bytes, { headers: { "content-type": "image/png" } });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function item(id: string): Item {
  const frame = { x: 0, y: 0, width: 200, height: 100 };
  return {
    id,
    sourceId: id,
    frame,
    placement: {
      destination: frame,
      sourceCrop: { top: 0, right: 0, bottom: 0, left: 0 },
      alignment: { horizontal: "center", vertical: "center" },
    },
    visible: true,
    opacity: 1,
    rotation: 0,
    kind: "layer",
    props: {},
  };
}

/** Setup with `logo.png` at `hash`, then a scene with one image. */
function messages(hash: AssetEntry["hash"]): readonly StreamMessage[] {
  const snapshot: Snapshot = {
    revision: 1,
    id: "show",
    canvas: { width: 1920, height: 1080 },
    sources: [
      { id: "logo", kind: "image", props: { src: "logo.png" }, size: { width: 200, height: 100 } },
    ],
    scenes: [{ id: "main", items: [item("logo")] }],
  };
  return [
    {
      kind: "setup",
      id: "show",
      canvas: { width: 1920, height: 1080 },
      kinds: ["image"],
      assets: { version: "v1", entries: [{ name: "logo.png", hash }] },
      serve: { assets: "https://cdn.example/show/assets/" },
    },
    { kind: "update", snapshot },
  ];
}

interface BoundaryProps {
  readonly children: ReactNode;
}
interface BoundaryState {
  readonly error?: Error;
}
class Boundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = {};
  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }
  override render(): ReactNode {
    const { error } = this.state;
    return error === undefined ? this.props.children : <p className="error">{error.message}</p>;
  }
}

function render(ui: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container, { onCaughtError: () => undefined });
  roots.push(root);
  act(() => {
    root.render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
  });
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("useAsset", () => {
  it("suspends until the asset is downloaded and verified, once per hash", async () => {
    // Two stages show the image; the fallback shows until one download resolves both.
    let release: () => void = () => undefined;
    const fetch = serve(LOGO, new Promise((resolve) => (release = resolve)));
    const queue = createAsyncQueue<StreamMessage>();
    const container = render(
      <Stream source={queue}>
        <Suspense fallback={<p className="loading" />}>
          <Stage />
          <Stage />
        </Suspense>
      </Stream>,
    );
    for (const message of messages(await sha256(LOGO))) queue.push(message);
    await settle();
    expect(container.querySelector(".loading")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();

    release();
    await settle();
    const images = [...container.querySelectorAll("img")];
    expect(images.map((image) => image.getAttribute("src"))).toEqual([
      "blob:asset-0",
      "blob:asset-0",
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0].href).toBe("https://cdn.example/show/assets/logo.png");
  });

  it("throws a hash mismatch to the error boundary", async () => {
    serve(new TextEncoder().encode("tampered"), Promise.resolve());
    const queue = createAsyncQueue<StreamMessage>();
    const container = render(
      <Stream source={queue}>
        <Boundary>
          <Suspense fallback={null}>
            <Stage />
          </Suspense>
        </Boundary>
      </Stream>,
    );
    for (const message of messages(await sha256(LOGO))) queue.push(message);
    await settle();
    expect(container.querySelector(".error")?.textContent).toContain(
      'Asset "logo.png" failed verification',
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("throws for a name the manifest does not list", async () => {
    serve(LOGO, Promise.resolve());
    function Missing(): ReactNode {
      return <img src={useAsset("missing.png")} alt="" />;
    }
    const queue = createAsyncQueue<StreamMessage>();
    const container = render(
      <Stream source={queue}>
        <Boundary>
          <Suspense fallback={null}>
            <Missing />
          </Suspense>
        </Boundary>
      </Stream>,
    );
    for (const message of messages(await sha256(LOGO))) queue.push(message);
    await settle();
    expect(container.querySelector(".error")?.textContent).toContain('"missing.png" is not in');
  });
});
