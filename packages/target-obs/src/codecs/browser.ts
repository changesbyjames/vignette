import { DEFAULT_BROWSER_SOURCE_CSS, type BrowserSource } from "@strangecyan/vignette-core";

import { selectInputKind, type ObsSourceCodec } from "./types.js";

/** Built-in OBS browser-source codec. */
export const browserCodec: ObsSourceCodec<BrowserSource> = {
  kind: "source:browser",
  inputKinds: ["browser_source"],
  refreshProperty: "refreshnocache",
  compile(source, context) {
    const inputKind = selectInputKind(this.inputKinds, context.availableInputKinds);
    if (inputKind === undefined) {
      return { supported: false, reason: "OBS browser source input kind is unavailable." };
    }
    const viewport = context.browserViewport ?? source.viewport;
    return {
      supported: true,
      inputKind,
      settings: {
        url: source.url,
        width: viewport.width,
        height: viewport.height,
        css: DEFAULT_BROWSER_SOURCE_CSS,
        shutdown: source.shutdownWhenHidden ?? false,
      },
    };
  },
};
