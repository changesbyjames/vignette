import {
  Broadcast,
  ColorSource,
  defineComposition,
  Layer,
  Scene,
  Sources,
} from "@strangecyan/vignette";
import type { ReactElement } from "react";

function Show(): ReactElement {
  return (
    <Broadcast>
      <Sources>
        <ColorSource id="background" color="#2563eb" size={{ width: 1280, height: 720 }} />
      </Sources>
      <Scene id="main" label="Main scene">
        <Layer id="background" sourceId="background" style={{ width: "100%", height: "100%" }} />
      </Scene>
    </Broadcast>
  );
}

/** The composition's identity, canvas, and top-level component. */
export const composition = defineComposition({
  id: "simple-example",
  canvas: { width: 1280, height: 720, frameRate: 30 },
  component: Show,
});
