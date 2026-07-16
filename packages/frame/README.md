# @cbj/react-obs-frame

Typed React DOM frames that become ordinary browser sources in React OBS snapshots. A frame is
server-rendered and hydrated as an independent React root, so hooks and client state remain local to
that browser source.

## Install

```sh
pnpm add jsr:@cbj/react-obs-frame jsr:@cbj/react-obs jsr:@cbj/react-obs-core react react-dom vite
```

## Define and place a frame

```tsx
import { frame, View } from "@cbj/react-obs-frame";
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
import { reactObsFrames } from "@cbj/react-obs-frame/vite";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [reactObsFrames()] });
```

`./vite` provides development discovery and module hosting. `./server` provides
`FrameRouteRegistry`, `createFrameRequestHandler`, and the production manifest module host.
`./client` exports the hydration helper. `@cbj/react-obs-server` wires these seams together for the
common host topology.

Frame parameters must be serializable and are parsed on both placement and request. Keep frame
modules browser-safe. The configured public origin must be reachable by every browser and OBS host
that renders the source.
