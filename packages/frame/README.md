# @strangecyan/vignette-frame

Typed React DOM frames that become ordinary browser sources in Vignette snapshots. A frame is
server-rendered and hydrated as an independent React root, so hooks and client state remain local to
that browser source.

## Install

```sh
pnpm add @strangecyan/vignette-frame @strangecyan/vignette-vite react react-dom vite
```

## Define and place a frame

```tsx
import { frame, View } from "@strangecyan/vignette-frame";
import { z } from "zod";

export const LowerThird = frame({
  params: z.object({ name: z.string() }),
  view: ({ name }) => <div>Hello {name}</div>,
});

export const OnAir = frame({ view: () => <div>On air</div> });

export function Overlay() {
  return (
    <>
      <View source={LowerThird} params={{ name: "Ada" }} style={{ width: 960, height: 160 }} />
      <View source={OnAir} style={{ width: 240, height: 80 }} />
    </>
  );
}
```

Frames without parameters omit `params` in both `frame()` and `<View>`. A view's page renders at the
placement's laid-out size unless `viewport` is set.

Export frame definitions from modules processed by the Vite plugin:

```ts
import { vignette } from "@strangecyan/vignette-vite";
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
import { defineRemoteStore } from "@strangecyan/vignette-frame/remote-store";

import type { CompositionStore } from "./composition-store";

export const compositionStore = defineRemoteStore<CompositionStore>({ id: "composition" });
// compositionStore.url === "/__vignette/store/composition"
```

The endpoint defaults to `/__vignette/store/<id>`; pass `url` to serve it elsewhere. The application
serves the SSE response at `ref.url`, so the route needs no ID check. The server helper yields an
initial context snapshot followed by conflated live updates:

```ts
import { encodeRemoteStoreSnapshot } from "@strangecyan/vignette-frame/remote-store";
import { remoteStoreSnapshots } from "@strangecyan/vignette-frame/remote-store/server";

app.get(compositionStore.url, (context) =>
  streamSSE(context, async (stream) => {
    for await (const snapshot of remoteStoreSnapshots(store, context.req.raw.signal)) {
      await stream.writeSSE({ data: encodeRemoteStoreSnapshot(snapshot) });
    }
  }),
);
```

Register store routes before any catch-all `/__vignette/*` handler. Read the state inside a frame.
The hook suspends during server rendering and until the browser receives its first snapshot; every
frame already renders beneath a root `<Suspense fallback={null}>`, so no boundary is needed:

```tsx
import { frame } from "@strangecyan/vignette-frame";
import { useRemoteStore } from "@strangecyan/vignette-frame/remote-store/client";

export const titleFrame = frame({
  view: () => {
    const title = useRemoteStore(compositionStore, (snapshot) => snapshot.context.title);
    return <div>{title}</div>;
  },
});
```

Add your own `<Suspense>` only to scope a different fallback to part of a view.

Hosts that cannot run the transform can provide supported metadata directly with
`frame({ metadata, params, view })`.

Frame parameters must be serializable and are parsed on both placement and request. Keep frame
modules browser-safe. `<View>` emits a root-relative URL (`/__vignette/frame/...`); each target
resolves it against its own base URL, which must reach the frame host from wherever the source is
rendered (the DOM page or OBS).
