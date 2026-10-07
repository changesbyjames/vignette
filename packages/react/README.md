# @strangecyan/vignette

Node-side React renderer for authoring fixed-canvas broadcast scenes. React mutates a local
authoring graph; each commit is compiled into a complete, target-neutral snapshot. This package does
not render DOM and performs no remote I/O.

## Install

```sh
pnpm add @strangecyan/vignette @strangecyan/vignette-core react
```

## Define a composition

A composition definition is the single source of a project's identity: its ID (the OBS namespace,
also sent to every runtime), canvas, extension source modules, and top-level component.

```tsx
// src/show.tsx
import {
  Broadcast,
  ColorSource,
  Layer,
  Scene,
  Sources,
  defineComposition,
} from "@strangecyan/vignette";

function Show() {
  return (
    <Broadcast>
      <Sources>
        <ColorSource id="background" color="#101820" />
      </Sources>
      <Scene id="main">
        <Layer id="background" sourceId="background" />
      </Scene>
    </Broadcast>
  );
}

export const composition = defineComposition({
  id: "demo",
  canvas: { width: 1920, height: 1080, frameRate: 60 },
  extensions: [], // e.g. [moqSourceModule]
  component: Show,
});
```

By convention a composition module exports exactly one definition as the named export `composition`,
so hosts and tooling can load it from a module path.

## Host a composer

```ts
import { createComposerRoot } from "@strangecyan/vignette";

import { composition } from "./show.js";

const root = createComposerRoot(composition, { assets, onError: console.error });
await root.render();

for await (const message of root.messages(signal)) publish(message);
```

`render()` renders the composition's component. Pass an element instead —
`root.render(<Providers><Show /></Providers>)` — when a host wraps the component in providers or a
test renders an ad hoc tree. The second argument holds host-owned settings only: `assets`,
`onError`, `layoutEngine`, and `strictMode`.

Sources are reusable resource definitions. Layers place sources in scenes. `Box` participates in
Yoga layout but never becomes a target object. IDs are explicit because React keys do not identify
remote resources.

Call `dispose()` when the composer shuts down. Observe asynchronous failures through `onError` and
root status, not delayed React exceptions. Custom source packages provide a `sourceElement` wrapper
and a core `SourceModule`; list the module in the composition's `extensions`.

The root owns the immutable setup — project ID, asset manifest, and the extension source kinds the
composition registered (with each module's target `entrypoints` hints) — and replays it plus its
latest update to every `messages()` subscriber. `settled()` synchronously flushes externally
scheduled React work and resolves to the compiled snapshot, enabling read-your-writes after
external-store mutations.
