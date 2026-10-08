/**
 * React authoring component for Media over QUIC sources.
 *
 * @module
 */
import { sourceElement, type SourceProps } from "@strangecyan/vignette";
import type { ReactElement } from "react";

import { MOQ_SOURCE_KIND, type MoqSource as MoqSourceDefinition } from "./index.js";

/** Author-facing props for the React MoQ source component. */
export type MoqSourceProps = SourceProps<MoqSourceDefinition>;

/** Declares one MoQ source. List `moqSourceModule` in the composition's `extensions` alongside this. */
export function MoqSource(props: MoqSourceProps): ReactElement {
  return sourceElement<MoqSourceDefinition>(MOQ_SOURCE_KIND, props);
}
