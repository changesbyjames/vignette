# Architecture

The authoring renderer is tested against the exact pair `react@19.2.7` and
`react-reconciler@0.33.0`. Because the reconciler API is experimental, upgrades are host-config
migrations rather than routine dependency bumps.

## Data flow

```text
Node composer
  React components + hooks
    -> synchronous local authoring graph
    -> validation + Yoga + content fitting
    -> one immutable complete snapshot (revision N)
         |
         +-- SSE ----------------------> DOMRuntime -> browser DOM
         |
         +-- in-memory AsyncIterable --> OBSRuntime -> OBS planner -> obs-websocket
         |
         +-- SSE ----------------------> remote OBSRuntime process (optional)
```

React, reconciliation, validation, and common layout run only in the Node composer. The composer
does not import a DOM implementation, an OBS client, or runtime status. It publishes one
target-neutral snapshot after each valid React commit, including commits triggered by hooks and
timers inside the composed tree.

## Runtime message protocol

Every runtime input is one of three closed message types:

- `setup`: an asset manifest, sent before snapshots;
- `update`: one complete compiled snapshot;
- `event`: a uniquely identified one-shot command, separate from desired state.

SSE uses the same names as event types. A newly connected consumer receives the current setup and
latest complete update. Transient commands are not part of snapshot replay. The example uses the
same `AsyncIterable<RuntimeMessage>` contract directly for its embedded OBS runtime, so transports
remain outside runtime implementations.

Snapshots have monotonically increasing revisions. Runtimes use mailbox-of-one convergence and may
discard stale revisions. Runtime application status is deliberately local: the composer does not
wait for or collect DOM/OBS settlement.

## Assets

Snapshots refer to assets only by logical name. Before updates, the backend sends a versioned
manifest containing each name and HTTP(S) URL, with optional SHA-256 integrity.

- `DOMRuntime` downloads assets and maps their names to browser-owned blob URLs.
- `OBSRuntime` downloads assets into a private temporary directory on the OBS machine and maps names
  to local paths.

Replacing a manifest builds the new cache before releasing the previous one. Runtime disposal
revokes blob URLs or removes the temporary directory.

## Representations and ownership

The mutable authoring graph exists only to satisfy React's host contract. The compiled snapshot is
immutable, serializable plain data containing source definitions, flattened Yoga layout, crop,
content placement, visibility, opacity, rotation, and canonical order.

The DOM runtime owns browser elements by explicit source ID. It parks inactive stateful sources and
uses atomic `moveBefore()` when available so iframe loading state survives scene changes. The OBS
runtime owns the WebSocket connection, observation, planning, retries, and managed OBS namespace.
Neither runtime inspects React fibers or authoring nodes.

## Optional React DOM frames

`@cbj/vignette-frame` can lower a typed `<View>` into a normal browser source plus layer. Its Vite
adapter owns module metadata, parameter validation, server-rendered HTML, and browser hydration.
Core, snapshots, and runtimes see only the resulting absolute URL, viewport, IDs, and geometry. This
keeps DOM React content composable without making React DOM or a bundler part of the common scene
protocol. See [`react-frames.md`](react-frames.md).

## Package ownership

- `@cbj/vignette-core`: graph vocabulary, immutable snapshots, runtime messages, validation, and
  Yoga.
- `@cbj/vignette`: Node-side React reconciler, primitives, and `createComposerRoot`.
- `@cbj/vignette-frame`: optional typed browser views, SSR/hydration, and Vite adapter.
- `@cbj/vignette-target-dom`: browser asset cache and `DOMRuntime`.
- `@cbj/vignette-target-obs`: temporary-file asset cache, `OBSRuntime`, planner, and transport.
- `@cbj/vignette-testkit`: deterministic OBS transport and planner test utilities.

The renderer remains synchronous and local. All downloads, sockets, retries, DOM work, and OBS work
are runtime concerns beyond the compiled snapshot boundary.

The base DOM target has no React dependency. `@cbj/vignette-target-dom/react` is an optional adapter
that combines a container callback ref, abort-aware runtime stream, DOMRuntime lifecycle, and a
cached `useSyncExternalStore` subscription. See [`dom-compositor-hook.md`](dom-compositor-hook.md).
