# Architecture

The authoring renderer is tested against the exact pair `react@19.2.7` and
`react-reconciler@0.33.0`. Because the reconciler API is experimental, upgrades are host-config
migrations rather than routine dependency bumps.

## Vocabulary

Vignette's pipeline is **composer → stream → target**:

| Term               | Meaning                                                                                                                                       | API                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Composition**    | A project's identity (ID, canvas), extension source modules, and top-level React component.                                                   | `defineComposition`                                                      |
| **Composer**       | The Node-side React root that renders a composition, compiles each commit into a snapshot, and publishes the stream.                          | `createComposerRoot`, `ComposerRoot`, `compile`                          |
| **Snapshot**       | Immutable, target-neutral compiled scene data with a revision.                                                                                | `CompiledSnapshot`                                                       |
| **Stream**         | The ordered messages a composer publishes: `setup`, then `update` (snapshots) and `event` (one-shot commands). Carried over SSE or in memory. | `StreamMessage`, `StreamSource`, `sseStream`, `consumeStream`, `/stream` |
| **Target**         | Something that renders snapshots in one medium: the browser DOM or OBS.                                                                       | `DomTarget`, `createObsTarget`                                           |
| **Target runtime** | Consumes a stream for one target: checks setup (project, extensions), downloads assets, applies updates, and forwards events.                 | `TargetRuntime`, `DOMRuntime`, `OBSRuntime`                              |
| **Stage**          | A DOM container in a React app that a `DOMRuntime` renders a stream into.                                                                     | `useStage`                                                               |

"Transport" is reserved for how bytes move (SSE, the OBS WebSocket `ObsTransport`); it is not a
separate concept from the stream.

## Data flow

```text
Platform host (Node, Worker, Durable Object)
  React components + hooks
    -> synchronous local authoring graph
    -> validation + Yoga + content fitting
    -> one immutable complete snapshot (revision N)
         |
         +-- SSE (/stream) ------------> DOMRuntime -> browser DOM (useStage)
         |
         +-- in-memory AsyncIterable --> OBSRuntime -> OBS planner -> obs-websocket
         |
         +-- SSE ----------------------> remote OBSRuntime process (optional)
```

React, reconciliation, validation, and common layout run only in the composer host. The composer
does not import a DOM implementation, an OBS client, or runtime status. It publishes one
target-neutral snapshot after each valid React commit, including commits triggered by hooks and
timers inside the composed tree.

## Stream protocol

Every message a composer streams to target runtimes is one of three closed types:

- `setup`: the composition's project ID, its asset manifest, and the extension source kinds it
  registered (with target entrypoint hints), sent before snapshots;
- `update`: one complete compiled snapshot;
- `event`: a uniquely identified one-shot command, separate from desired state.

Runtimes validate setup before accepting snapshots. The OBS runtime refuses a stream whose project
ID differs from the namespace it was configured to manage, and every runtime refuses a stream that
advertises an extension source kind it has no renderer or codec for. Both are observable `error`
phases with actionable messages, never exceptions thrown into the composer.

SSE uses the same names as event types. A newly connected consumer receives the current setup and
latest complete update. Transient commands are not part of snapshot replay. The example uses the
same `AsyncIterable<StreamMessage>` contract directly (`consumeStream(runtime, root.messages())`)
for its embedded OBS runtime, so transports remain outside target runtime implementations.

Snapshots have monotonically increasing revisions. Runtimes use mailbox-of-one convergence and may
discard stale revisions. Runtime application status is deliberately local: the composer does not
wait for or collect DOM/OBS settlement.

## Assets

Snapshots refer to assets only by logical name. Before updates, the backend sends a versioned
manifest containing each name and URL, with optional SHA-256 integrity. Manifest and browser-source
URLs are absolute HTTP(S) or root-relative (`/assets/...`); each runtime resolves root-relative URLs
against its own base URL, so the composer never needs its public origin. See
[URL resolution](compatibility-contract.md#url-resolution).

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

`@strangecyan/vignette-frame` can lower a typed `<View>` into a normal browser source plus layer.
Its Vite adapter owns module metadata, parameter validation, server-rendered HTML, and browser
hydration. Core, snapshots, and runtimes see only the resulting root-relative URL, viewport, IDs,
and geometry. This keeps DOM React content composable without making React DOM or a bundler part of
the common scene protocol. See [`react-frames.md`](react-frames.md).

## Package ownership

- `@strangecyan/vignette-core`: graph vocabulary, immutable snapshots, stream messages, validation,
  and Yoga.
- `@strangecyan/vignette`: host-side React reconciler, primitives, `createComposerRoot`, `compile`,
  and re-exports of the core types composition authors use (layout styles, geometry, canvas, assets,
  snapshot and stream message types). Core stays the low-level contract for target and extension
  authors.
- `@strangecyan/vignette-frame`: optional typed browser views and platform-neutral SSR/hydration
  kernels.
- `@strangecyan/vignette-vite`: static frame registry, deterministic client entries, asset
  manifests, and the optional dev-server composer.
- `@strangecyan/vignette-target-dom`: browser asset cache and `DOMRuntime`.
- `@strangecyan/vignette-target-obs`: temporary-file asset cache, `OBSRuntime`, planner, and
  transport.
- `@strangecyan/vignette-testkit`: deterministic OBS transport and planner test utilities.

The renderer remains synchronous and local. All downloads, sockets, retries, DOM work, and OBS work
are runtime concerns beyond the compiled snapshot boundary.

The base DOM target has no React dependency. `@strangecyan/vignette-target-dom/react` is an optional
adapter that combines a container callback ref, abort-aware composer stream, DOMRuntime lifecycle,
and a cached `useSyncExternalStore` subscription. See [`dom-stage-hook.md`](dom-stage-hook.md).
