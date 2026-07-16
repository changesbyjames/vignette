# @cbj/react-obs-core

Target-neutral contracts and compiler for React OBS. This package defines the authoring graph,
branded IDs, source modules, Yoga layout, immutable compiled snapshots, assets, diagnostics, and
runtime message protocol. It does not import React or a target implementation.

## Install

```sh
pnpm add jsr:@cbj/react-obs-core
```

## Compile without React

```ts
import { compileBroadcast, projectId, sceneId, sourceId, layerId } from "@cbj/react-obs-core";
import { broadcast, colorSource, layer, scene, sources } from "@cbj/react-obs-core/builders";

const snapshot = compileBroadcast(
  broadcast({
    projectId: projectId("demo"),
    canvas: { width: 1920, height: 1080, frameRate: 60 },
    children: [
      sources(colorSource({ id: sourceId("background"), color: "#101820" })),
      scene({
        id: sceneId("main"),
        children: [layer({ id: layerId("background"), sourceId: sourceId("background") })],
      }),
    ],
  }),
  1,
);
```

Use `asset()` and an `AssetManifest` for resources that targets must resolve. Use
`RuntimeMessageHub`, `consumeRuntimeMessages`, and the SSE codecs to connect a composer to one or
more independent targets. Extension packages augment `SourceKinds` and contribute a `SourceModule`;
pass those modules to the compiler or composer rather than using an open settings bag.

The `./builders` entrypoint is optional. React projects normally author the same graph with
`@cbj/react-obs`.
