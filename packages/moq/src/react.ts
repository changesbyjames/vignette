/**
 * React authoring component for Media over QUIC sources.
 *
 * @module
 */
import { sourceElement, type SourceProps } from "@strangecyan/vignette";
import type { ReactElement } from "react";

import type { MoqSource as MoqSourceDefinition } from "./index.js";

/** Author-facing props for the React MoQ source component. */
export type MoqSourceProps = SourceProps<MoqSourceDefinition>;

/** Declares one MoQ source. Register `moqSourceModule` on the composer root alongside this. */
export function MoqSource(props: MoqSourceProps): ReactElement {
  return sourceElement<MoqSourceDefinition>("source:moq", props);
}
