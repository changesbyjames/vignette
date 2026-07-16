# @cbj/vignette-frame

Typed React DOM frames that become ordinary browser sources in Vignette snapshots. A frame is
server-rendered and hydrated as an independent React root, so hooks and client state remain local to
that browser source.

## Install

```sh
pnpm add jsr:@cbj/vignette-frame jsr:@cbj/vignette jsr:@cbj/vignette-core react react-dom vite
```

## Define and place a frame

```tsx
import { frame, View } from "@cbj/vignette-frame";
import { z } from "zod";

export const LowerThird = frame({
  params: z.object({ name: z.string() }),
  view: ({ name }) => <div>Hello {name}</div>,
});

export function Overlay() {
  return <View source={LowerThird} params={{ name: "Ada" }} />;
}
```

Export frame definitions from modules processed by the Vite plugin:

```ts
import { vignetteFrames } from "@cbj/vignette-frame/vite";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [vignetteFrames()] });
```

`./vite` provides development discovery and module hosting. `./server` provides
`FrameRouteRegistry`, `createFrameRequestHandler`, and the production manifest module host.
`./client` exports the hydration helper. `@cbj/vignette-server` wires these seams together for the
common host topology.

Frame parameters must be serializable and are parsed on both placement and request. Keep frame
modules browser-safe. The configured public origin must be reachable by every browser and OBS host
that renders the source.
