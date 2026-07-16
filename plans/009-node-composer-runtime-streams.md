# Plan 009: Move composition to Node and stream complete snapshots

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH — changes ownership of rendering, assets, and target lifecycle
- **Depends on**: `plans/008-vertical-slice-and-parity.md`
- **Planned at**: `unborn main`, 2026-07-15

## Decisions

- React composition runs in Node and emits one complete, immutable snapshot per revision.
- The composer has no DOM or OBS target awareness and receives no apply acknowledgements.
- A runtime message stream contains `setup`, `update`, and `event` messages.
- `setup` carries a logical asset manifest. Snapshots refer only to asset names.
- DOM downloads assets to blob URLs; OBS downloads them to a private temporary directory.
- The example sends snapshots to DOM over SSE and to an embedded OBS runtime through the same
  in-memory `AsyncIterable` bus.
- Declarative snapshots and one-shot control events remain separate.

## Implementation steps

### 1. Define target-neutral runtime contracts

- Add asset manifest, runtime event, runtime message, and snapshot runtime contracts to core.
- Add an `AsyncIterable` message consumer helper.
- Rename asset references from local paths to logical names.
- Remove target selection nodes from the React authoring graph and compiler.

### 2. Make the React root a Node composer

- Replace target attachment with snapshot subscriptions.
- Compile and publish one neutral snapshot after each valid React commit.
- Preserve synchronous reconciler host mutations; perform no network or target I/O.
- Prove hook-driven timer updates produce new revisions.

### 3. Build independent DOM and OBS runtimes

- Expose `DOMRuntime` and `OBSRuntime` classes with `setup`, `update`, `event`, and `dispose`.
- Keep apply status and settlement local to each runtime.
- Retain DOM media and iframe instances across scene changes.
- Keep OBS planning pure and convergence asynchronous behind `OBSRuntime`.

### 4. Add per-runtime asset materialization

- Validate and download a complete manifest before accepting snapshots.
- Verify optional SHA-256 integrity values.
- Atomically replace caches on a new setup message.
- Revoke DOM blob URLs and remove the OBS temporary directory on disposal.

### 5. Replace the studio with a Node-composed streaming example

- Run the composer in a Vite backend plugin.
- Broadcast replayable setup and latest update messages through a multicast bus.
- Serve named SSE events at `/runtime` for the browser runtime.
- Feed an optional embedded OBS runtime from an in-memory bus subscription.
- Use a React `useState` timer to demonstrate server-side live revisions.

### 6. Verify and document the replacement architecture

- Update architecture, getting-started, example, and root documentation.
- Add runtime, asset cache, browser SSE, and in-memory OBS integration tests.
- Run install, build, typecheck, unit tests, lint, and formatting checks.
- Run Playwright and the studio production build; run guarded live OBS integration when OBS is
  available.

## Acceptance criteria

- [x] Node is the only process that runs the custom React reconciler in the example.
- [x] DOM receives complete snapshots over SSE.
- [x] OBS can receive the same stream through an in-memory `AsyncIterable`.
- [x] Neither runtime reports apply state to the composer.
- [x] Asset names resolve independently to browser blobs and OBS-local files.
- [x] Inactive DOM browser/video resources retain their underlying elements.
- [x] Snapshot and control-event channels are distinct.
- [x] All verification gates pass after the refactor.

## Verification result

Completed on 2026-07-15 with all six repository gates, 33 unit tests in 16 files, the studio Vite
production build, and three browser Playwright tests passing. The live OBS integration probe was
not run because the configured local WebSocket port was not listening; the probe remains guarded and
requires an explicitly named disposable scene collection.

## Deferred work

- Authentication, WAN deployment, resumable event delivery, and multi-broadcast routing.
- Scene-module hot loading and durable control-event storage.
- Runtime apply telemetry aggregation in a separate observability service.
- Frame-by-frame animation and high-frequency media control over SSE.
