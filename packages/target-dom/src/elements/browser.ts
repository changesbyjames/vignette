import {
  DEFAULT_BROWSER_SOURCE_CSS,
  resolveResourceUrl,
  type BrowserSource,
  type Size,
} from "@strangecyan/vignette-core";

import type { DomSourceRenderer } from "./types.js";

/** Built-in iframe renderer for browser sources. */
export const browserRenderer: DomSourceRenderer<BrowserSource> = {
  kind: "source:browser",
  retainWhenHidden(source) {
    return !(source.shutdownWhenHidden ?? false);
  },
  create(document, context) {
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
      update(source, item) {
        if (source.kind !== "source:browser") {
          throw new TypeError("Browser renderer received another source kind.");
        }
        updateBrowser(
          frame,
          /* SAFETY: The source registry selects this module by its source kind after core validation of that definition. */ source as BrowserSource,
          context.baseUrl,
          item.frame,
        );
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

/** Compiled snapshots carry a resolved viewport; the layer frame is the same default core applies. */
function updateBrowser(
  frame: HTMLIFrameElement,
  source: BrowserSource,
  baseUrl: string,
  layerFrame: Size,
): void {
  const url = resolveResourceUrl(source.url, baseUrl);
  if (frame.src !== url) frame.src = url;
  const viewport = source.viewport ?? layerFrame;
  frame.width = String(viewport.width);
  frame.height = String(viewport.height);
}
