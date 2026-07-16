import { layerId, projectId, sceneId, sourceId, type CompiledSnapshot } from "@cbj/vignette-core";
import { Broadcast, ColorSource, Layer, Scene, Sources, createComposerRoot } from "@cbj/vignette";

const root = createComposerRoot({
  projectId: projectId("simple-example"),
  canvas: { width: 1280, height: 720, frameRate: 30 },
  onError: console.error,
});

let publishSnapshot: (snapshot: CompiledSnapshot) => void = () => undefined;
const nextSnapshot = new Promise<CompiledSnapshot>((resolve) => {
  publishSnapshot = resolve;
});
const unsubscribe = root.subscribe(publishSnapshot);

await root.render(
  <Broadcast>
    <Sources>
      <ColorSource
        id={sourceId("background")}
        color="#2563eb"
        size={{ width: 1280, height: 720 }}
      />
    </Sources>
    <Scene id={sceneId("main")} label="Main scene">
      <Layer
        id={layerId("background")}
        sourceId={sourceId("background")}
        style={{ width: "100%", height: "100%" }}
      />
    </Scene>
  </Broadcast>,
);

console.log(JSON.stringify(await nextSnapshot, null, 2));
unsubscribe();
await root.dispose();
