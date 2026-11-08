import type { Frame } from "../../core/sources/frame.js";
import type { ObsSourcePlugin } from "../plugin.js";
import { browserInput } from "./browser.js";

/**
 * `<Frame>` as a `browser_source` of the frame page, `serve.frames?frame=…&source=…&stream=…`.
 * The page follows the stream for its params, so a params change leaves the URL, and the page,
 * as they are. A new frame bundle's `build` changes the URL's `v=`, and OBS reloads that source.
 */
export const frameObs: ObsSourcePlugin<typeof Frame> = {
  kind: "frame",
  create: (source, { frames }) => ({
    input: browserInput(
      frames(source.props.frame, source.id, source.props.build),
      source.size,
      false,
    ),
  }),
};
