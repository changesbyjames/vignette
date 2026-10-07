# Kitchen-sink example

A full-stack Vignette application with no local media assets to provision. It demonstrates a Vite
browser preview, a Node composer, Yoga layout, color and MoQ sources, typed React frames with SSR
and hydration, runtime updates over SSE, production builds, and optional OBS output. The only remote
input is the public `https://cdn.moq.dev/demo` / `bbb.hang` MoQ demo stream.

```sh
corepack pnpm --filter @strangecyan/vignette-kitchen-sink dev
```

Open `http://127.0.0.1:4173`. The custom React reconciler runs in the Vite Node process, `/runtime`
serves complete snapshots over SSE, and the browser applies them through `DOMRuntime`.

Useful entry points:

- `src/show.tsx` defines the sources, Yoga layout, layers, and frame views, and exports the
  `composition` definition (project ID `kitchen-sink`, canvas, MoQ extension) that every host
  renders.
- `src/label.frame.tsx` is a parameterized React DOM frame.
- `src/clock.frame.tsx` demonstrates independent client hydration and state.
- `src/backend/plugin.tsx` hosts the composer during Vite development.
- `src/server/entry.tsx` and `src/server/obs-worker.ts` are production host and OBS entries.
- `src/app.tsx` consumes the same runtime stream in the browser.

The browser preview renders the MoQ source through `@moq/watch`. OBS output requires the
`moq_source` plugin that implements the contract used by `@strangecyan/vignette-moq/obs`. To use the
CLI instead of the bundled worker, pass the composition's ID and the MoQ codec:

```sh
pnpm exec vignette obs --project kitchen-sink --obs-url ws://127.0.0.1:4455 \
  --url http://127.0.0.1:4173/runtime --extension @strangecyan/vignette-moq/obs
```

To connect a disposable local OBS instance while developing, set `VIGNETTE_ENABLE_EMBEDDED=1` and
optionally provide `VIGNETTE_OBS_URL` and `VIGNETTE_OBS_PASSWORD`.

The composer never needs its public origin: frame URLs in snapshots are root-relative and each
target resolves them. The browser resolves them against `/runtime`; the embedded OBS runtime uses
the server's local address; the standalone worker uses `VIGNETTE_RUNTIME_URL`, plus
`VIGNETTE_BROWSER_SOURCE_BASE_URL` when OBS reaches the host at a different address (see
`compose.yaml` and [`docs/deployment.md`](../../docs/deployment.md)).
