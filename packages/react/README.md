# @cbj/vignette

Node-side React renderer for authoring fixed-canvas broadcast scenes. React mutates a local
authoring graph; each commit is compiled into a complete, target-neutral snapshot. This package does
not render DOM and performs no remote I/O.

## Install

```sh
pnpm add jsr:@cbj/vignette jsr:@cbj/vignette-core react
```

## Compose a scene

```tsx
import { layerId, projectId, sceneId, sourceId } from "@cbj/vignette-core";
import { Broadcast, ColorSource, Layer, Scene, Sources, createComposerRoot } from "@cbj/vignette";

const root = createComposerRoot({
  projectId: projectId("demo"),
  canvas: { width: 1920, height: 1080, frameRate: 60 },
  onError: console.error,
});

await root.render(
  <Broadcast>
    <Sources>
      <ColorSource id={sourceId("background")} color="#101820" />
    </Sources>
    <Scene id={sceneId("main")}>
      <Layer id={layerId("background")} sourceId={sourceId("background")} />
    </Scene>
  </Broadcast>,
);

for await (const message of root.messages(signal)) publish(message);
```

Sources are reusable resource definitions. Layers place sources in scenes. `Box` participates in
Yoga layout but never becomes a target object. IDs are explicit because React keys do not identify
remote resources.

Call `dispose()` when the composer shuts down. Observe asynchronous failures through `onError` and
root status, not delayed React exceptions. Custom source packages provide a `sourceElement` wrapper
and a core `SourceModule`; register the module through `createComposerRoot({ extensions })`.

The root owns the immutable asset manifest and replays setup plus its latest update to every
`messages()` subscriber. `settled()` synchronously flushes externally scheduled React work and
resolves to the compiled snapshot, enabling read-your-writes after external-store mutations.
