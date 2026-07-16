// @vitest-environment jsdom

import {
  DEFAULT_BROWSER_SOURCE_CSS,
  layerId,
  sourceId,
  type BrowserSource,
  type CompiledItem,
} from "@cbj/react-obs-core";
import { describe, expect, it } from "vitest";

import { browserRenderer } from "./browser.js";

const browser: BrowserSource = {
  kind: "source:browser",
  id: sourceId("browser"),
  url: "about:blank",
  viewport: { width: 1280, height: 720 },
};

const item: CompiledItem = {
  id: layerId("browser-layer"),
  content: { kind: "source", sourceId: browser.id },
  frame: { x: 0, y: 0, width: 1280, height: 720 },
  visible: true,
  opacity: 1,
  rotation: 0,
};

describe("browser element", () => {
  it("injects the shared default CSS into an accessible iframe document", () => {
    const sourceElement = browserRenderer.create(document);
    document.body.append(sourceElement.element);

    sourceElement.update(browser, item);

    const frame = sourceElement.element as HTMLIFrameElement;
    const style = frame.contentDocument?.querySelector<HTMLStyleElement>(
      "style[data-react-obs-browser-css]",
    );
    expect(style?.textContent).toBe(DEFAULT_BROWSER_SOURCE_CSS);
    expect(frame.dataset.reactObsCssInjection).toBe("applied");
  });

  it("reapplies the default CSS after an iframe load", () => {
    const sourceElement = browserRenderer.create(document);
    document.body.append(sourceElement.element);
    sourceElement.update(browser, item);

    const frame = sourceElement.element as HTMLIFrameElement;
    frame.contentDocument?.querySelector("style[data-react-obs-browser-css]")?.remove();
    frame.dispatchEvent(new Event("load"));

    expect(
      frame.contentDocument?.querySelector("style[data-react-obs-browser-css]")?.textContent,
    ).toBe(DEFAULT_BROWSER_SOURCE_CSS);
  });
});
