import {
  DEFAULT_BROWSER_SOURCE_CSS,
  isRootRelativeUrl,
  resolveResourceUrl,
  type BrowserSource,
} from "@strangecyan/vignette-core";

import { selectInputKind, type ObsSourceCodec } from "./types.js";

/** Built-in OBS browser-source codec. */
export const browserCodec: ObsSourceCodec<BrowserSource> = {
  kind: "source:browser",
  inputKinds: ["browser_source"],
  refreshProperty: "refreshnocache",
  /** Require an advertised input kind and a base for root-relative URLs before emitting settings. */
  compile(source, context) {
    const inputKind = selectInputKind(this.inputKinds, context.availableInputKinds);
    if (inputKind === undefined) {
      return { supported: false, reason: "OBS browser source input kind is unavailable." };
    }
    if (isRootRelativeUrl(source.url) && context.baseUrl === undefined) {
      return {
        supported: false,
        reason: `Browser source '${source.id}' has root-relative URL '${source.url}', but the OBS target has no browser source base URL.`,
      };
    }
    const viewport = context.browserViewport ?? source.viewport;
    return {
      supported: true,
      inputKind,
      settings: {
        url: resolveResourceUrl(source.url, context.baseUrl),
        width: viewport.width,
        height: viewport.height,
        css: DEFAULT_BROWSER_SOURCE_CSS,
        shutdown: source.shutdownWhenHidden ?? false,
      },
    };
  },
};
