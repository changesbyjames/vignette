# Implementation Plans

Generated on 2026-07-15 from a greenfield repository. Execute in the order
below unless dependencies say otherwise. Each executor must read its plan fully,
honor its STOP conditions, run every verification gate, and update its status
row when finished.

The repository had no commits when these plans were authored, so the plans use
`unborn main` as their baseline. Plan 001 establishes the first reproducible
workspace and verification commands.

## Execution order and status

| Plan | Title | Priority | Effort | Depends on | Status |
|---|---|---:|---:|---|---|
| 001 | Establish the workspace and architecture contracts | P1 | M | — | DONE |
| 002 | Implement the neutral scene graph and validation | P1 | L | 001 | DONE |
| 003 | Compile deterministic layout snapshots with Yoga | P1 | L | 002 | DONE |
| 004 | Materialize compiled snapshots in the DOM | P1 | M | 003 | DONE |
| 005 | Build the pure OBS state model and update planner | P1 | L | 003 | DONE |
| 006 | Implement asynchronous OBS convergence and recovery | P1 | L | 005 | DONE |
| 007 | Add the React custom renderer and root API | P1 | L | 002, 006 | DONE |
| 008 | Deliver the vertical slice and parity harness | P1 | L | 004, 006, 007 | DONE |
| 009 | Move composition to Node and stream complete snapshots | P1 | L | 008 | DONE |
| 010 | Add optional hydrated React DOM frames | P1 | L | 009 | DONE |
| 011 | Make DOMRuntime an external store and add useCompositor | P1 | M | 009 | DONE |
| 012 | Add a portable MoQ source | P1 | M | 009, 011 | DONE |
| 013 | Recompose the host surface into a pull-based kernel | P1 | L | 009, 010, 012 | DONE |

Status values: `TODO`, `IN PROGRESS`, `DONE`, `BLOCKED (<reason>)`, or
`REJECTED (<reason>)`.

### Acceptance note (2026-07-15)

Plans 001–008 pass TypeScript
6.0.3, React 19.2.7, react-reconciler 0.33.0, Vite 8.1.4, Vitest 4.1.10, and
Playwright 1.61.1. All 38 unit tests pass, and the three-test browser suite plus
its deterministic 1920x1080 DOM golden passed twice consecutively. The guarded
real-OBS create/reorder/reconnect/remove/ownership/cleanup path passed against
OBS Studio 32.1.2 with obs-websocket 5.7.3. DOM/OBS PNG parity produced 0
differing pixels, a ratio of `0`, and cleanup left no managed namespace or test
sentinel resources.

### Node composer acceptance note (2026-07-15)

Plan 009 passes the six repository gates, 33 unit tests across 16 files, the studio Vite production
build, and all three browser SSE/asset-lifecycle Playwright tests. The guarded real-OBS probe was not
run because no process was listening on the configured local WebSocket port; it remains opt-in and
requires the disposable collection guard.

### React DOM frame acceptance note (2026-07-15)

Plan 010 passes the six repository gates, 39 unit tests across 19 files, the studio Vite production
build, and all three Playwright tests. The end-to-end frame assertion covers Node SSR, Zod rejection,
browser hydration, common transparent CSS, and iframe persistence across streamed revisions.

### DOM compositor hook acceptance note (2026-07-15)

Plan 011 passes the six repository gates, 40 unit tests across 20 files, the studio Vite production
build, and all three Playwright tests. The React Strict Mode browser path now owns SSE and
`DOMRuntime` through `useCompositor` while preserving all asset, frame hydration, and iframe
lifecycle behavior.

## Dependency notes

- 002 depends on 001 because all later packages rely on the workspace, package
  names, strict TypeScript settings, and verification scripts established there.
- 003 depends on 002 because Yoga compiles the validated neutral graph rather
  than React elements or target-specific nodes.
- 004 and 005 both depend on 003 because both consume identical absolute
  rectangles, crop data, and canonical child order from a compiled snapshot.
- 006 depends on 005 because asynchronous execution must consume a separately
  tested operation plan; it must not rediscover diff logic while requests run.
- 007 depends on 002 and 006 so the reconciler remains a thin producer of an
  already-proven graph and revision pipeline.
- 008 is the first real vertical slice and therefore depends on both targets and
  the React authoring layer.
- 009 replaces the browser-owned orchestration from 008 with a Node composer,
  explicit runtime protocol, per-runtime asset cache, and SSE/in-memory delivery.
- 010 adds optional schema-typed React DOM frames that lower to existing browser sources while a
  Vite adapter owns SSR and hydration.
- 011 adds a React-optional DOM adapter with callback-ref lifecycle, SSE consumption, and cached
  external-store state.
- 012 adds one portable MoQ definition with `@moq/watch` and the custom OBS `moq_source` as target
  codecs.

## Architectural invariants shared by every plan

1. React mutates only a local in-memory authoring graph.
2. Yoga is the canonical layout engine for every target.
3. Compiled snapshots are immutable, target-neutral plain data.
4. OBS is an eventually consistent remote target, never React's host tree.
5. Source definitions and layer placements are distinct identities.
6. React keys are never used as persistent OBS identities.
7. Target-specific nodes cannot silently alter common flex flow.
8. Declarative desired state and one-shot commands remain separate.
9. Managed OBS resources are namespaced; unmanaged resources are never changed.
10. The first slice permits at most one placement of a source per scene.

## Deferred directions, not part of these plans

- Native OBS plugin or vendor API.
- Audio routing, filters, transitions, replay-buffer controls, and capture cards.
- Frame-by-frame animation over WebSocket.
- Native text parity and font deployment.
- Cooperative adoption of manually-created OBS resources.
- Multiple OBS canvases or scene collections.
- Repeated placement of one source in the same scene; this requires durable
  placement metadata or a different materialization strategy.
- Changing an asset manifest during a composer root's lifetime; construct a new root for a new
  build-derived manifest.

## Findings considered and rejected

- Start with the React reconciler: rejected because it would couple renderer API
  churn to graph, layout, and remote-state debugging before those contracts are
  proven independently.
- Use browser CSS layout for the DOM target: rejected because Yoga/DOM default,
  intrinsic-size, and rounding behavior would create target drift.
- Make every architecture layer its own package immediately: rejected because
  `layout-yoga` and `obs-transport` have only one consumer in the first slice;
  extract them after a second consumer appears.
- Treat OBS request batches as transactions: rejected because batches can halt
  after failure but do not roll back successful earlier requests.
