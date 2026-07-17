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

Hosts that cannot run the transform can provide supported metadata directly with
`frame({ metadata, params, view })`.

Frame parameters must be serializable and are parsed on both placement and request. Keep frame
modules browser-safe. The configured public origin must be reachable by every browser and OBS host
that renders the source.
