# Kitchen-sink example

A full-stack Vignette application with no local media assets to provision. It demonstrates a Vite
browser preview, a Node composer, Yoga layout, color and MoQ sources, typed React frames with SSR
and hydration, runtime updates over SSE, production builds, and optional OBS output. The only remote
input is the public `https://cdn.moq.dev/demo` / `bbb.hang` MoQ demo stream.

```sh
corepack pnpm --filter @cbj/vignette-kitchen-sink dev
```

Open `http://127.0.0.1:4173`. The custom React reconciler runs in the Vite Node process, `/runtime`
serves complete snapshots over SSE, and the browser applies them through `DOMRuntime`.

Useful entry points:

- `src/show.tsx` defines the sources, Yoga layout, layers, and frame views.
- `src/label.frame.tsx` is a parameterized React DOM frame.
- `src/clock.frame.tsx` demonstrates independent client hydration and state.
- `src/backend/plugin.tsx` hosts the composer during Vite development.
- `src/server/entry.tsx` and `src/server/obs-worker.ts` are production host and OBS entries.
- `src/app.tsx` consumes the same runtime stream in the browser.

The browser preview renders the MoQ source through `@moq/watch`. OBS output requires the
`moq_source` plugin that implements the contract used by `@cbj/vignette-moq/obs`.

To connect a disposable local OBS instance while developing, set `VIGNETTE_ENABLE_EMBEDDED=1` and
optionally provide `VIGNETTE_OBS_URL` and `VIGNETTE_OBS_PASSWORD`.
