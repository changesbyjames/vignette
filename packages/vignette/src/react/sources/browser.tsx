import type { Browser } from "../../core/sources/browser.js";
import type { ReactSourcePlugin } from "../plugin.js";
import { PageFrame } from "./page.js";

/** `<Browser>` as a sandboxed iframe of its URL; only a changed URL navigates. */
export const BrowserView: ReactSourcePlugin<typeof Browser> = {
  kind: "browser",
  View: ({ source }) => <PageFrame url={source.props.url} title={source.id} />,
};
