# @cbj/vignette-frame

Typed React DOM frames that become ordinary browser sources in Vignette snapshots. A frame is
server-rendered and hydrated as an independent React root, so hooks and client state remain local to
that browser source.

## Install

```sh
pnpm add jsr:@cbj/vignette-frame jsr:@cbj/vignette-vite react react-dom vite
```

## Define and place a frame

```tsx
import { createSceneStore, frame, SceneProvider, View } from "@cbj/vignette-frame";
import { z } from "zod";

export const LowerThird = frame({
  params: z.object({ name: z.string() }),
  view: ({ name }) => <div>Hello {name}</div>,
});

export function Overlay() {
  return (
    <SceneProvider scene={createSceneStore({ origin: "https://example.com" })}>
      <View source={LowerThird} params={{ name: "Ada" }} />
    </SceneProvider>
  );
}
```

Export frame definitions from modules processed by the Vite plugin:

```ts
import { vignette } from "@cbj/vignette-vite";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [vignette()] });
```

`./server` provides `FrameRouteRegistry`, pure rendering kernels, and a Fetch API handler over a
static frame bundle. `./server/node` adds a Node HTTP adapter. `./transform` exposes the source
transform and `./client` exports the hydration helper. Applications own routing and transport.

## Stream live state to a frame

Frame parameters are part of the browser source URL. Use a remote store for live state that should
update without reloading the frame. Define one typed reference in code shared by the application
server and frame:

```ts
import { defineRemoteStore } from "@cbj/vignette-frame/remote-store";

import type { CompositionStore } from "./composition-store";

export const compositionStore = defineRemoteStore<CompositionStore>({
  id: "composition",
  url: "/api/store/composition",
});
```

The application owns the endpoint URL and SSE response. The server helper yields an initial context
snapshot followed by conflated live updates:

```ts
import { encodeRemoteStoreSnapshot } from "@cbj/vignette-frame/remote-store";
import { remoteStoreSnapshots } from "@cbj/vignette-frame/remote-store/server";

for await (const snapshot of remoteStoreSnapshots(store, request.signal)) {
  await stream.writeSSE({ data: encodeRemoteStoreSnapshot(snapshot) });
}
```

Read the state inside a hydrated frame. The hook suspends during server rendering and until the
browser receives its first snapshot, so render it beneath a Suspense boundary:

```tsx
import { useRemoteStore } from "@cbj/vignette-frame/remote-store/client";
import { Suspense } from "react";

function Title() {
  return (
    <Suspense fallback={null}>
      <LiveTitle />
    </Suspense>
  );
}

function LiveTitle() {
  const title = useRemoteStore(compositionStore, (snapshot) => snapshot.context.title);
  return <div>{title}</div>;
}
```

Hosts that cannot run the transform can provide supported metadata directly with
`frame({ metadata, params, view })`.

Frame parameters must be serializable and are parsed on both placement and request. Keep frame
modules browser-safe. The configured public origin must be reachable by every browser and OBS host
that renders the source.
