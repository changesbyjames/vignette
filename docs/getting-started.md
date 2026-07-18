# Getting started

Install Node.js 22 or newer, then install and verify the workspace:

```sh
corepack pnpm install
corepack pnpm build
corepack pnpm test
corepack pnpm --filter @strangecyan/vignette-simple-example start
```

This prints a compiled snapshot without starting any services. For the complete application:

```sh
corepack pnpm --filter @strangecyan/vignette-kitchen-sink dev
```

Open `http://127.0.0.1:4173`. The Vite backend owns a persistent custom React root. A timer inside
the composed React component updates `useState`, producing a new complete snapshot every second. The
backend streams setup and update messages over `/runtime`; the browser contains only a `DOMRuntime`
consumer.

The browser shell mounts that consumer with one hook:

```tsx
const [ref, compositor] = useCompositor({
  sceneId: "main",
  transport: sseRuntimeSource("/runtime"),
});

return <div ref={ref} data-phase={compositor.phase} />;
```

See [`dom-compositor-hook.md`](dom-compositor-hook.md) for custom streams, status fields, SSR
behavior, and direct `DOMRuntime` external-store usage.

The same backend contains the in-memory OBS example:

```ts
const runtime = new OBSRuntime({ projectId, url, password });
await consumeRuntimeMessages(runtime, messageBus.subscribe());
```

Enable it while running the kitchen sink with:

```sh
VIGNETTE_ENABLE_EMBEDDED=1 \
VIGNETTE_OBS_URL=ws://127.0.0.1:4455 \
VIGNETTE_OBS_PASSWORD='runtime-only' \
corepack pnpm --filter @strangecyan/vignette-kitchen-sink dev
```

A standalone OBS process uses the same `OBSRuntime`; only `messageBus.subscribe()` changes to an SSE
decoder.

## Runtime lifecycle

Both runtime implementations follow the same ordering:

```ts
await runtime.setup(assetManifest);
runtime.update(completeSnapshot);
await runtime.event(command);
await runtime.dispose();
```

The composer does not attach runtimes or inspect their status. Each runtime may expose local status
and settlement APIs for its own operator, tests, and UI.

## Real React DOM content

The kitchen sink's panels are defined with `frame({ params, view })` and placed with `<View>`. Their
URLs are a normal browser source in the compiled snapshot, but the backend serves server-rendered
HTML and a hydration modules for the original React components. Open the kitchen sink and inspect
the clock; its seconds counter is state owned by the iframe React root.

See [`react-frames.md`](react-frames.md) for the typed API, Vite setup, lifecycle, and security
constraints.

## Guarded OBS integration probe

Use only a disposable OBS profile and scene collection:

```sh
VIGNETTE_ALLOW_INTEGRATION=1 \
VIGNETTE_OBS_URL=ws://127.0.0.1:4455 \
VIGNETTE_OBS_PASSWORD='runtime-only' \
VIGNETTE_OBS_TEST_COLLECTION='Vignette Tests' \
corepack pnpm test:obs-integration
```

The probe consumes an in-memory runtime stream, exercises initial and updated complete snapshots,
and cleans its uniquely managed OBS namespace.
