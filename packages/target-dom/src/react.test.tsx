// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCompositor, type RuntimeMessageSource } from "./react.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useCompositor", () => {
  const mounted: ReturnType<typeof createRoot>[] = [];

  afterEach(() => {
    act(() => {
      for (const root of mounted.splice(0)) root.unmount();
    });
  });

  it("does not restart when operational callback identities change", () => {
    const consume = vi.fn();
    const transport: RuntimeMessageSource = () => {
      consume();
      return new ReadableStream();
    };
    const container = document.createElement("div");
    const root = createRoot(container);
    mounted.push(root);

    function Compositor({ revision }: { readonly revision: number }) {
      const [ref] = useCompositor({
        sceneId: "main",
        transport,
        onError: () => revision,
        fetch: (...input) => globalThis.fetch(...input),
        createObjectURL: () => `blob:${String(revision)}`,
        revokeObjectURL: () => revision,
      });
      return <div ref={ref} />;
    }

    act(() => {
      root.render(<Compositor revision={1} />);
    });
    act(() => {
      root.render(<Compositor revision={2} />);
    });

    expect(consume).toHaveBeenCalledTimes(1);
  });
});
