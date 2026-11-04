import type { Frame } from "../../core/sources/frame.js";
import type { DomSourcePlugin } from "../plugin.js";
import { createPageFrame, disposePageFrame, navigatePageFrame } from "./page.js";

/**
 * `<Frame>` as an iframe of the frame page, `serve.frames?frame=…&source=…&stream=…`, exactly as
 * OBS opens it. The page follows the stream and reads its params from there, so a params change
 * never reloads it; only a different frame name navigates.
 */
export const frameDom: DomSourcePlugin<typeof Frame> = {
  kind: "frame",
  create(source, { document, frames }) {
    const frame = createPageFrame(document, frames(source.props.frame, source.id));
    return {
      element: frame,
      update(next) {
        navigatePageFrame(frame, frames(next.props.frame, next.id));
      },
      dispose() {
        disposePageFrame(frame);
      },
    };
  },
};
