# React DOM frames

`@strangecyan/vignette-frame` places typed React DOM content in a scene as an ordinary browser
source. A frame's params are live props: they travel in each snapshot, and the frame page re-renders
in place when they change. Core snapshots and target runtimes stay unaware of schemas, React DOM,
and server rendering.

## Authoring

```tsx
import { frame, View } from "@strangecyan/vignette-frame";
import { z } from "zod";

export const greeting = frame({
  params: z.object({ name: z.string() }),
  view: ({ name }) => <div>Hello {name}!</div>,
});

export const banner = frame({ view: () => <div>On air</div> });

<View id="greeting" source={greeting} params={{ name }} style={{ width: 1280, height: 720 }} />;
<View id="banner" source={banner} style={{ width: 800, height: 120 }} />;
```

`id` names both the layer and its browser source, so it must be unique like any other source ID.
Omit `params` for a frame without parameters; its `<View>` placements omit `params` too. The page
renders at the placement's laid-out size unless `viewport` is set. A frame placed at several
different sizes needs an explicit `viewport` or separate `id`s.

## How a placement reaches the page

`<View>` validates `params` against the frame's schema and lowers to a browser source:

- Its URL is `/__vignette/frame/<routeKey>/<id>`. It names only the frame and the placement, so it
  never changes, and neither the DOM nor the OBS target ever reloads the page.
- Its `props` field carries the parsed params as canonical JSON. Targets ignore `props`.

The frame page subscribes to the composer stream, finds its own source by `id` in each update, and
re-renders when that source's props change. Composer state therefore flows into frames as props, the
way it flows into any other component. Hooks, timers, and animation inside a frame stay local to
that page.

Every frame on one origin shares a single stream connection. Browsers allow only six HTTP/1.1
connections per host, so a connection per frame would starve other requests in scenes with a handful
of frames. Pages elect one leader with a Web Lock; the leader holds the connection and relays each
update over a `BroadcastChannel`, and the next page takes over when the leader unloads.

Each frame renders beneath a root `<Suspense fallback={null}>`, so views can use suspending hooks
such as `useRemoteStore` without their own boundary, and the page stays empty until its first props
arrive.

Params are JSON and travel in every snapshot that every target receives. Never include secrets or
sensitive data. Each change to a param is a composer commit and a new snapshot, which suits titles,
scores, and lower thirds. Keep animation and high-frequency state inside the frame or in a remote
store.

## Build integration

```ts
import { vignette } from "@strangecyan/vignette-vite";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [vignette()] });
```

The plugin rewrites exported `frame()` calls to carry build metadata, using Vite's own parser. It
statically imports every discovered `src/**/*.frame.{tsx,jsx}` module into `virtual:vignette/frames`
and emits deterministic browser entries. During `vite dev` with the `composition` option, the plugin
serves frames itself, with live props from its dev composer.

Production hosts import `frames` and serve them beside the composer stream:

```ts
import { createFrameRequestHandler, resolveFrame } from "@strangecyan/vignette-frame/server";
import { frames } from "virtual:vignette/frames";

const options = { stream: "/stream", snapshot: () => root.snapshot };

// Hono, Workers, Deno, Bun
const handleFrame = createFrameRequestHandler(frames, options);
app.all("/__vignette/*", (c) => handleFrame(c.req.raw) ?? c.notFound());

// Express, Fastify, Koa, node:http, ...: no Request/Response round trip
const frame = resolveFrame(frames, req.url, options);
if (frame === undefined) return next();
res.writeHead(frame.status, frame.headers).end(frame.body);
```

`stream` is the composer stream URL the page subscribes to; it defaults to `/stream`. `snapshot`
lets the host server-render each page with its current props. Hosts that run apart from the composer
can omit it, and pages then render once the stream delivers their first snapshot. Hosts can also
call `renderFrameHtml` from their own router.

The page loads the frame module and the mount helper from a short inline module script. No dynamic
module loading or client manifest is required. Frame modules must remain browser-safe: the same
module is imported for server rendering and in the browser. Frame HTML and the deterministic client
entries should use `Cache-Control: no-store`.

Hosts that cannot run the Vite plugin can provide metadata directly with
`frame({ metadata, params, view })`.

## Remote stores

A remote store streams application state to frames without a composer commit. Use one for state the
composer does not need to know about, or that changes too often to snapshot. See the package
[README](../packages/frame/README.md#remote-stores) for the API. Serving one is a single route:

```ts
import { createRemoteStoreHandler } from "@strangecyan/vignette-frame/remote-store/server";

const handleTitle = createRemoteStoreHandler(titleStore, store);
app.get(titleStore.url, (c) => handleTitle(c.req.raw) ?? c.notFound());
```
