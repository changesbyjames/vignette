import type { Size } from "../../core/geometry.js";
import type { Browser } from "../../core/sources/browser.js";
import type { ObsInput, ObsSourcePlugin } from "../plugin.js";

/** Makes the page body transparent and unscrolled, as a broadcast overlay expects. */
const TRANSPARENT_BODY_CSS =
  "body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }";

/** `<Browser>` as a `browser_source` whose viewport is the source's laid-out size. */
export const browserObs: ObsSourcePlugin<typeof Browser> = {
  kind: "browser",
  create: (source) => ({
    input: browserInput(source.props.url, source.size, source.props.shutdownWhenHidden),
  }),
};

/** A `browser_source` input for a page at `url` with a `size` viewport. */
export function browserInput(url: string, size: Size, shutdown: boolean): ObsInput {
  return {
    kind: "browser_source",
    settings: {
      url,
      width: Math.round(size.width),
      height: Math.round(size.height),
      css: TRANSPARENT_BODY_CSS,
      shutdown,
    },
  };
}

/** A `browser_source` input showing the local HTML file `file` with a `size` viewport. */
export function localPageInput(file: string, size: Size): ObsInput {
  return {
    kind: "browser_source",
    settings: {
      is_local_file: true,
      local_file: file,
      width: Math.round(size.width),
      height: Math.round(size.height),
      css: TRANSPARENT_BODY_CSS,
      shutdown: false,
    },
  };
}
