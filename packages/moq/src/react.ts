/**
 * React authoring component for Media over QUIC sources.
 *
 * @module
 */
import { sourceElement, type SourceProps } from "@cbj/vignette";
import type { ReactElement } from "react";

import "./index.js";

export type MoqSourceProps = SourceProps<"source:moq">;

/** Declares one MoQ source. Register `moqSourceModule` on the composer root alongside this. */
export function MoqSource(props: MoqSourceProps): ReactElement {
  return sourceElement("source:moq", props);
}
