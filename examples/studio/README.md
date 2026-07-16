# Vignette Studio

This is a complete application example, not a published package. It demonstrates the topology an
external project can build from the `@cbj` packages: a Vite browser client, Node composer host,
typed frame SSR/hydration, runtime SSE, and an optional standalone or embedded OBS worker.

Run the backend composer and browser runtime:

```sh
corepack pnpm --filter @cbj/vignette-studio dev
```

Open `http://127.0.0.1:4173`.

The custom React reconciler runs inside the Vite Node process. A timer-driven hook produces complete
snapshots, `/runtime` serves them as SSE, and the browser only downloads the manifest and applies
snapshots through `DOMRuntime`. The backend can optionally instantiate `OBSRuntime` and feed it the
same messages through an in-memory `AsyncIterable` by setting `VIGNETTE_ENABLE_EMBEDDED=1`.

The “Hello James!” overlay is an exported `frame()` definition. The Vite frame adapter serves its
server-rendered HTML and hydration module, while the scene snapshot contains only a normal browser
source URL. Its hook-driven seconds counter demonstrates that this is an independent React DOM root,
not markup rendered by the custom scene reconciler.

The browser shell uses
`useCompositor({ sceneId: "main", transport: sseRuntimeSource("/runtime") })`; the hook owns the SSE
connection and `DOMRuntime`, while the returned snapshot drives the displayed phase and revision.

The motion panel is a live MoQ source. The DOM target renders `https://cdn.moq.dev/demo` /
`bbb.hang` through `@moq/watch`; the OBS target maps the same snapshot source to the custom
`moq_source` input. Run OBS with that plugin installed before enabling the embedded OBS runtime.

## Reuse in another project

Install the same public dependency set:

```sh
pnpm add jsr:@cbj/vignette jsr:@cbj/vignette-core \
  jsr:@cbj/vignette-frame jsr:@cbj/vignette-server \
  jsr:@cbj/vignette-target-dom jsr:@cbj/vignette-target-obs \
  jsr:@cbj/vignette-moq react react-dom zod
pnpm add -D vite
```

Copy the application structure rather than its workspace metadata. The reusable boundaries are:

- `src/show.tsx`: source definitions, scenes, layers, and frame views.
- `src/backend/plugin.tsx`: development composer and frame middleware.
- `src/server/entry.tsx`: production HTTP host and frame manifest loading.
- `src/server/obs-worker.ts`: independently deployable OBS target consuming SSE.
- `src/app.tsx`: browser DOM target consuming the same SSE stream.
- `vite.config.ts` and `vite.ssr.config.ts`: client and Node production builds.

Keep explicit resource IDs stable across renders and deployments. Set `frameOrigin` to an HTTP(S)
origin reachable by browser and OBS hosts, serve the asset manifest URLs from that origin, and route
`ComposerHost.handleRequest` before static fallback so `/runtime` and frame routes remain available.
