# React DOM frames

`@cbj/vignette-frame` is an optional bridge for content that should remain a real React DOM
application while appearing as a normal browser source in both targets. Core snapshots do not know
about frame definitions, schemas, server rendering, or hydration.

## Authoring

Put each frame in a client-safe module and export the definition:

```tsx
import { frame } from "@cbj/vignette-frame";
import { z } from "zod";

export const greeting = frame({
  params: z.object({ name: z.string() }),
  view: ({ name }) => <div>Hello {name}!</div>,
});
```

The schema's synchronous `parse()` return type becomes the `view` props type and the required type
of `<View params>`. Zod is used by the example but is not a dependency of the frame package; any
synchronous schema with `parse(input)` works.

Place the frame directly in common Yoga layout:

```tsx
import { FrameProvider, View } from "@cbj/vignette-frame";

<FrameProvider origin="http://127.0.0.1:4173">
  <Broadcast>
    <Scene id={sceneId("main")}>
      <View
        source={greeting}
        params={{ name: "James" }}
        viewport={{ width: 1280, height: 720 }}
        style={{ width: 640, height: 360 }}
      />
    </Scene>
  </Broadcast>
</FrameProvider>;
```

`View` validates and canonicalizes params during Node composition, then lowers to one ordinary
browser source and layer. Its identity is derived from the transformed module/export and canonical
params. Supply `id="stable-name"` when the same frame+params combination is placed more than once or
when identity must stay fixed while params change.

`viewport` remains the frame's intrinsic coordinate space for aspect-ratio, contain, cover, and crop
calculation. The DOM iframe and OBS browser input are rendered at the layer's realized canvas size,
so responsive CSS and CSS pixel measurements agree across targets without OBS shrinking a larger
browser texture after paint. Give placements that need different realized sizes distinct IDs,
because one OBS browser input has only one native render size.

The provider origin must be reachable from every runtime. `127.0.0.1` is appropriate only when the
composer backend, browser, and OBS are on the same machine.

## Vite adapter

Enable the optional Vite integration before the composer plugin:

```ts
import { vignetteFrames } from "@cbj/vignette-frame/vite";

export default defineConfig({
  plugins: [vignetteFrames(), vignetteComposer()],
});
```

The adapter transforms exported `frame()` calls to attach stable module and export metadata. On a
frame request it:

1. loads the original module through Vite's server module pipeline;
2. decodes and validates the URL params;
3. renders the React component to HTML in the server runtime;
4. serves an external hydration module that imports the same frame export in the browser; and
5. calls `hydrateRoot()` with the same validated props.

Frame modules should contain browser-safe imports. Do not define a frame in a module that imports
OBS clients, filesystem APIs, the custom reconciler, or secret server configuration because the same
module is imported by the iframe browser.

The route handler itself is host-agnostic and lives in `@cbj/vignette-frame/server`
(`createFrameRequestHandler` plus `FrameRouteRegistry`); the Vite plugin is a thin development
binding that supplies module loading and client-URL resolution through the `ModuleHost` seam. Placed
`<View>`s register their frame definitions at render time through `FrameRegistrarProvider`, so hosts
need no frame-module lists: in production the same Fetch API handler serves SSR straight from the
in-memory definitions and resolves hydration imports through a supplied Vite client build manifest
(`createClientManifestModuleHost`). Node hosts can use the filesystem-backed adapter from
`@cbj/vignette-frame/server/node`. See [`deployment.md`](deployment.md) for the production topology.

## Parameter and security contract

- Params must be JSON-safe plain objects and arrays containing strings, booleans, finite numbers,
  and null. Cycles, class instances, functions, symbols, bigint, and undefined are rejected.
- Params are present in the browser-source URL. Never put passwords, tokens, private keys, or
  sensitive personal data in frame params.
- The server validates params again before SSR, and the hydration client validates once more.
- JSON embedded in HTML is escaped before insertion into the non-executable props script.
- URLs are complete desired state. Changing params changes the URL and therefore creates a distinct
  derived source unless an explicit `id` is supplied.

## Lifecycle

The DOM runtime treats a frame as a stateful iframe and parks it when inactive, preserving its React
tree across scene changes. OBS treats the same URL as a normal browser input. React state inside the
frame is local to each runtime: the DOM iframe and OBS browser source do not share hook state.
Shared state should come from an application service or a separate event/data channel.
