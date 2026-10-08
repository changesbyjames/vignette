import { DEFAULT_BROWSER_SOURCE_CSS, type BrowserSource } from "@strangecyan/vignette-core";
import { describe, expect, it } from "vitest";

import { browserCodec } from "./browser.js";

describe("browserCodec", () => {
  it("passes the shared default CSS to the native OBS browser source", () => {
    const source: BrowserSource = {
      kind: "source:browser",
      id: "browser",
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
      id: "browser",
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

  it("resolves root-relative URLs against the browser source base URL", () => {
    const source: BrowserSource = {
      kind: "source:browser",
      id: "frame",
      url: "/__vignette/frame/label?props=%7B%7D",
      viewport: { width: 1280, height: 720 },
    };
    const availableInputKinds = new Set(["browser_source"]);

    expect(
      browserCodec.compile(source, { availableInputKinds, baseUrl: "http://127.0.0.1:4173/" }),
    ).toMatchObject({
      supported: true,
      settings: { url: "http://127.0.0.1:4173/__vignette/frame/label?props=%7B%7D" },
    });
    expect(browserCodec.compile(source, { availableInputKinds })).toMatchObject({
      supported: false,
      reason: expect.stringMatching(/no browser source base URL/u),
    });
  });
});
