# @strangecyan/vignette-frame

Typed React DOM frames that become ordinary browser sources in Vignette snapshots. A frame's params
are live props: change them in the composition and the frame re-renders in place, without reloading
its page. Each frame is an independent React root, so hooks and client state stay local to it.

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

export function Overlay({ guest }: { guest: string }) {
  return (
    <>
      <View
        id="lower-third"
        source={LowerThird}
        params={{ name: guest }}
        style={{ width: 960, height: 160 }}
      />
      <View id="on-air" source={OnAir} style={{ width: 240, height: 80 }} />
    </>
  );
}
```

`id` names the placement's layer and browser source. Frames without parameters omit `params` in both
`frame()` and `<View>`. A view's page renders at the placement's laid-out size unless `viewport` is
set. When `guest` changes, the composer publishes a new snapshot and the lower third re-renders in
place.

Export frame definitions from modules processed by the Vite plugin:

```ts
import { vignette } from "@strangecyan/vignette-vite";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [vignette()] });
```

## Serve frames

`./server` provides `createFrameRequestHandler` for Fetch API hosts and `resolveFrame`, which maps a
request target to a plain `{ status, headers, body }` result that any HTTP framework can send. Both
take the composer stream URL and, optionally, the current snapshot for server rendering:

```ts
const handleFrame = createFrameRequestHandler(frames, {
  stream: "/stream",
  snapshot: () => root.snapshot,
});
```

Pages are served at `/__vignette/frame/<routeKey>/<id>` and read their props from the stream. Every
frame on one origin shares one stream connection. `./client` exports `mountFrame`, which the page
calls from an inline module script. Applications own routing and transport.

## Remote stores

A remote store streams application state to frames without going through the composer. Use one for
state the composition does not need, or that changes too often to snapshot. Define one typed
reference in code shared by the application server and frame:

```ts
import { defineRemoteStore } from "@strangecyan/vignette-frame/remote-store";

import type { CompositionStore } from "./composition-store";

export const compositionStore = defineRemoteStore<CompositionStore>({ id: "composition" });
// compositionStore.url === "/__vignette/store/composition"
```

The endpoint defaults to `/__vignette/store/<id>`; pass `url` to serve it elsewhere. Serve it with
one route. The handler streams an initial context snapshot followed by conflated live updates:

```ts
import { createRemoteStoreHandler } from "@strangecyan/vignette-frame/remote-store/server";

const handleComposition = createRemoteStoreHandler(compositionStore, store);
app.get(compositionStore.url, (c) => handleComposition(c.req.raw) ?? c.notFound());
```

Hosts that write their own SSE loop can iterate `remoteStoreSnapshots(store, signal)` and encode
each snapshot with `encodeRemoteStoreSnapshot`. Register store routes before any catch-all
`/__vignette/*` handler.

Read the state inside a frame. The hook suspends during server rendering and until the browser
receives its first snapshot; every frame already renders beneath a root
`<Suspense fallback={null}>`, so no boundary is needed:

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

## Constraints

Frame params must be JSON-serializable objects. They are parsed when placed and again in the page,
and they travel in every snapshot, so never include secrets. Keep frame modules browser-safe.

Hosts that cannot run the Vite plugin can provide metadata directly with
`frame({ metadata, params, view })`.

`<View>` emits a root-relative URL (`/__vignette/frame/...`); each target resolves it against its
own base URL, which must reach the frame host from wherever the source is rendered (the DOM page or
OBS). The page resolves the stream URL against its own origin.
