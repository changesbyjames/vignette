import { describe, expect, it } from "vitest";

import { transformFrameModule } from "./vite.js";

describe("frame Vite transform", () => {
  it("injects stable client metadata into exported frame definitions", () => {
    const transformed = transformFrameModule(
      `import { frame as defineFrame } from "@cbj/vignette-frame";
export const greeting = defineFrame({ params: schema, view: Greeting });`,
      "/workspace/src/greeting.frame.tsx",
      "/workspace",
    );

    expect(transformed?.code).toContain('defineFrame.__withMetadata({"routeKey":"greeting-');
    expect(transformed?.code).toContain('"moduleUrl":"/src/greeting.frame.tsx"');
    expect(transformed?.code).toContain('"exportName":"greeting"})({');
  });
});
