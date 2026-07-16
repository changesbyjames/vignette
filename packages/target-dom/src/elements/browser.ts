import { DEFAULT_BROWSER_SOURCE_CSS, type BrowserSource } from "@cbj/vignette-core";

import type { DomSourceRenderer } from "./types.js";

export const browserRenderer: DomSourceRenderer<"source:browser"> = {
  kind: "source:browser",
  retainWhenHidden(source) {
    return !(source.shutdownWhenHidden ?? false);
  },
  create(document) {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.tabIndex = -1;

    const applyDefaultCss = (): void => {
      applyBrowserCss(frame, DEFAULT_BROWSER_SOURCE_CSS);
    };
    frame.addEventListener("load", applyDefaultCss);

    return {
      element: frame,
      update(source) {
        if (source.kind !== "source:browser") {
          throw new TypeError("Browser renderer received another source kind.");
        }
        updateBrowser(frame, source);
        applyDefaultCss();
      },
      dispose() {
        frame.removeEventListener("load", applyDefaultCss);
        frame.src = "about:blank";
      },
    };
  },
};

function applyBrowserCss(frame: HTMLIFrameElement, css: string): void {
  try {
    const document = frame.contentDocument;
    if (document === null) {
      frame.dataset.vignetteCssInjection = "blocked";
      return;
    }
    const parent = document.head;

    let style = document.querySelector<HTMLStyleElement>("style[data-vignette-browser-css]");
    if (style === null) {
      style = document.createElement("style");
      style.dataset.vignetteBrowserCss = "";
      parent.append(style);
    }
    style.textContent = css;
    frame.dataset.vignetteCssInjection = "applied";
  } catch {
    frame.dataset.vignetteCssInjection = "blocked";
  }
}

function updateBrowser(frame: HTMLIFrameElement, source: BrowserSource): void {
  if (frame.src !== source.url) frame.src = source.url;
  frame.width = String(source.viewport.width);
  frame.height = String(source.viewport.height);
}
