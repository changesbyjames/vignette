import type { Color } from "../../core/sources/color.js";
import type { ReactSourcePlugin } from "../plugin.js";

/** `<Color>` as a filled div. */
export const ColorView: ReactSourcePlugin<typeof Color> = {
  kind: "color",
  View: ({ source }) => (
    <div style={{ width: "100%", height: "100%", background: source.props.color }} />
  ),
};
