import { DEFAULT_BROWSER_SOURCE_CSS, sourceId, type BrowserSource } from "@cbj/vignette-core";
import { describe, expect, it } from "vitest";

import { browserCodec } from "./browser.js";

describe("browserCodec", () => {
  it("passes the shared default CSS to the native OBS browser source", () => {
    const source: BrowserSource = {
      kind: "source:browser",
      id: sourceId("browser"),
      url: "https://example.com/",
      viewport: { width: 1280, height: 720 },
    };

    const result = browserCodec.compile(source, {
      availableInputKinds: new Set(["browser_source"]),
    });

    expect(result).toMatchObject({
      supported: true,
      settings: { css: DEFAULT_BROWSER_SOURCE_CSS },
    });
  });

  it("uses a target-realized viewport when the planner supplies one", () => {
    const source: BrowserSource = {
      kind: "source:browser",
      id: sourceId("browser"),
      url: "https://example.com/",
      viewport: { width: 1280, height: 720 },
    };

    const result = browserCodec.compile(source, {
      availableInputKinds: new Set(["browser_source"]),
      browserViewport: { width: 560, height: 315 },
    });

    expect(result).toMatchObject({
      supported: true,
      settings: { width: 560, height: 315 },
    });
  });
});
