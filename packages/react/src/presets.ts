import type { LayoutStyle } from "@strangecyan/vignette-core";

/**
 * Layout preset that stretches a layer or box over its parent, e.g. a full-canvas background:
 * `<Layer id="background" sourceId="background" style={fill} />`. Spread it to extend it:
 * `style={{ ...fill, overflow: "hidden" }}`.
 */
export const fill: LayoutStyle = { position: "absolute", inset: 0, width: "100%", height: "100%" };
