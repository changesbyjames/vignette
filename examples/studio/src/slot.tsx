import { layerId, type LayoutStyle, type Size, type SourceId } from "@cbj/react-obs-core";
import { View } from "@cbj/react-obs-frame";
import { Box, Layer } from "@cbj/react-obs";
import type { ReactElement } from "react";

import { cameraLabel } from "./camera-label.frame.js";

const FILL: LayoutStyle = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
};

export interface SlotProps {
  readonly id: string;
  readonly cameraSourceId: SourceId;
  readonly label: string;
  readonly size: Size;
  readonly style: LayoutStyle;
  readonly hero?: boolean;
}

/** One camera placement and its independently rendered, parameterized label overlay. */
export function Slot(props: SlotProps): ReactElement {
  return (
    <Box style={props.style}>
      <Layer
        id={layerId(`slot.${props.id}.camera`)}
        sourceId={props.cameraSourceId}
        fit="cover"
        style={FILL}
      />
      <View
        id={`slot.${props.id}.label`}
        source={cameraLabel}
        params={{ name: props.label, hero: props.hero ?? false }}
        viewport={props.size}
        style={FILL}
      />
    </Box>
  );
}
