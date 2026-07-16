# Getting started

Install Node.js 22 or newer, then install and verify the workspace:

```sh
corepack pnpm install
corepack pnpm build
corepack pnpm test
corepack pnpm --filter @cbj/react-obs-studio dev
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

Enable it while running the studio with:

```sh
REACT_OBS_ENABLE_EMBEDDED=1 \
REACT_OBS_URL=ws://127.0.0.1:4455 \
REACT_OBS_PASSWORD='runtime-only' \
corepack pnpm --filter @cbj/react-obs-studio dev
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

The studio's overlay is defined with `frame({ params, view })` and placed with `<View>`. Its URL is
a normal browser source in the compiled snapshot, but the backend serves server-rendered HTML and a
hydration module for the original React component. Open the studio and inspect the gradient “Hello
James!” panel; its seconds counter is state owned by the iframe React root.

See [`react-frames.md`](react-frames.md) for the typed API, Vite setup, lifecycle, and security
constraints.

## Guarded OBS integration probe

Use only a disposable OBS profile and scene collection:

```sh
REACT_OBS_ALLOW_INTEGRATION=1 \
REACT_OBS_URL=ws://127.0.0.1:4455 \
REACT_OBS_PASSWORD='runtime-only' \
REACT_OBS_TEST_COLLECTION='React OBS Tests' \
corepack pnpm test:obs-integration
```

The probe consumes an in-memory runtime stream, exercises initial and updated complete snapshots,
and cleans its uniquely managed OBS namespace.
