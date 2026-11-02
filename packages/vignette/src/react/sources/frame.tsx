import type { ReactNode } from "react";

import type { Frame } from "../../core/sources/frame.js";
import { useFrameUrl } from "../hooks.js";
import type { ReactSourcePlugin, ReactSourceViewProps } from "../plugin.js";
import { PageFrame } from "./page.js";

/**
 * `<Frame>` as an iframe of the frame page, `serve.frames?frame=…&source=…&stream=…`, exactly as
 * the DOM and OBS targets open it. The page follows the stream and reads its params from there,
 * so a params change never reloads it; only a different frame name navigates.
 */
export const FrameView: ReactSourcePlugin<typeof Frame> = {
  kind: "frame",
  View: FrameSource,
};

function FrameSource({ source }: ReactSourceViewProps<typeof Frame>): ReactNode {
  return <PageFrame url={useFrameUrl(source.props.frame, source.id)} title={source.id} />;
}
