import { describe, expect, it, vi } from "vitest";

import { transformFrameDefinitions } from "./transform.js";

describe("transformFrameDefinitions", () => {
  it("transforms frames without a Vite or Node host", () => {
    const onMetadata = vi.fn();
    const result = transformFrameDefinitions(
      'import { frame } from "@strangecyan/vignette-frame";\nexport const title = frame({ params, view });',
      { id: "title.tsx", moduleUrl: "/frames/title.js", onMetadata },
    );

    expect(result?.code).toContain("frame.withMetadata(");
    expect(onMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ moduleUrl: "/frames/title.js", exportName: "title" }),
    );
  });
});
