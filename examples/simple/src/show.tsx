import { Color, Layer, Scene, Show } from "vignette";

export default (
  <Show id="simple-example" canvas={{ width: 1280, height: 720, frameRate: 30 }}>
    <Scene id="main">
      <Layer style={{ flex: 1 }}>
        <Color color="#2563eb" />
      </Layer>
    </Scene>
  </Show>
);
