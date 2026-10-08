// @vitest-environment jsdom

import {
  DEFAULT_BROWSER_SOURCE_CSS,
  type BrowserSource,
  type CompiledItem,
} from "@strangecyan/vignette-core";
import { describe, expect, it } from "vitest";

import { browserRenderer } from "./browser.js";

const browser: BrowserSource = {
  kind: "source:browser",
  id: "browser",
  url: "about:blank",
  viewport: { width: 1280, height: 720 },
};

const context = { baseUrl: "http://composer.example:4173/stream" };

const item: CompiledItem = {
  id: "browser-layer",
  content: { kind: "source", sourceId: browser.id },
  frame: { x: 0, y: 0, width: 1280, height: 720 },
  visible: true,
  opacity: 1,
  rotation: 0,
};

describe("browser element", () => {
  it("injects the shared default CSS into an accessible iframe document", () => {
    const sourceElement = browserRenderer.create(document, context);
    document.body.append(sourceElement.element);

    sourceElement.update(browser, item);

    const frame =
      /* SAFETY: The browser source module creates an iframe for this fixture; the test accesses iframe-only properties. */ sourceElement.element as HTMLIFrameElement;
    const style = frame.contentDocument?.querySelector<HTMLStyleElement>(
      "style[data-vignette-browser-css]",
    );
    expect(style?.textContent).toBe(DEFAULT_BROWSER_SOURCE_CSS);
    expect(frame.dataset.vignetteCssInjection).toBe("applied");
  });

  it("reapplies the default CSS after an iframe load", () => {
    const sourceElement = browserRenderer.create(document, context);
    document.body.append(sourceElement.element);
    sourceElement.update(browser, item);

    const frame =
      /* SAFETY: The browser source module creates an iframe for this fixture; the test accesses iframe-only properties. */ sourceElement.element as HTMLIFrameElement;
    frame.contentDocument?.querySelector("style[data-vignette-browser-css]")?.remove();
    frame.dispatchEvent(new Event("load"));

    expect(
      frame.contentDocument?.querySelector("style[data-vignette-browser-css]")?.textContent,
    ).toBe(DEFAULT_BROWSER_SOURCE_CSS);
  });

  it("resolves root-relative URLs against the target base URL", () => {
    const sourceElement = browserRenderer.create(document, context);
    const frameSource: BrowserSource = { ...browser, url: "/__vignette/frame/label?props=%7B%7D" };
    sourceElement.update(frameSource, item);

    const frame =
      /* SAFETY: The browser source module creates an iframe for this fixture; the test accesses iframe-only properties. */ sourceElement.element as HTMLIFrameElement;
    expect(frame.src).toBe("http://composer.example:4173/__vignette/frame/label?props=%7B%7D");
  });
});
