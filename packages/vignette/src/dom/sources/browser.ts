import type { Browser } from "../../core/sources/browser.js";
import type { DomSourcePlugin } from "../plugin.js";
import { createPageFrame, disposePageFrame, navigatePageFrame } from "./page.js";

/** `<Browser>` as a sandboxed iframe at the source's viewport. */
export const browserDom: DomSourcePlugin<typeof Browser> = {
  kind: "browser",
  create(source, { document }) {
    const frame = createPageFrame(document, source.props.url);
    return {
      element: frame,
      update(next) {
        navigatePageFrame(frame, next.props.url);
      },
      dispose() {
        disposePageFrame(frame);
      },
    };
  },
};
