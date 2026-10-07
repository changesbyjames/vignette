// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useStage, type StreamSource } from "./react.js";

interface ReactActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

interface StageRevision {
  readonly revision: number;
}

/* SAFETY: React uses this documented global flag for act; the test environment initializes that flag here. */ (
  globalThis as ReactActEnvironment
).IS_REACT_ACT_ENVIRONMENT = true;

describe("useStage", () => {
  const mounted: ReturnType<typeof createRoot>[] = [];

  afterEach(() => {
    act(() => {
      for (const root of mounted.splice(0)) root.unmount();
    });
  });

  it("does not restart when operational callback identities change", () => {
    const consume = vi.fn();
    const stream: StreamSource = () => {
      consume();
      return new ReadableStream();
    };
    const container = document.createElement("div");
    const root = createRoot(container);
    mounted.push(root);

    function Stage({ revision }: StageRevision) {
      const [ref] = useStage({
        sceneId: "main",
        stream,
        onError: () => revision,
        fetch: (...input) => globalThis.fetch(...input),
        createObjectURL: () => `blob:${String(revision)}`,
        revokeObjectURL: () => revision,
      });
      return <div ref={ref} />;
    }

    act(() => {
      root.render(<Stage revision={1} />);
    });
    act(() => {
      root.render(<Stage revision={2} />);
    });

    expect(consume).toHaveBeenCalledTimes(1);
  });
});
