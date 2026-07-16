# Plan 005: Build the pure OBS state model and update planner

> **Executor instructions**: Complete this plan without opening a WebSocket or
> importing React, DOM, or Yoga. The planner is a pure function over plain data.
> Run every verification gate and update the plan index when complete.
>
> **Drift check (run first)**:
> `git diff --stat HEAD -- packages/core packages/target-obs packages/testkit`

## Status

- **Priority**: P1
- **Effort**: L (four to six days)
- **Risk**: HIGH — identity or ordering mistakes can delete or visibly corrupt OBS scenes
- **Depends on**: `plans/003-yoga-layout-compiler.md`
- **Category**: architecture, correctness, tests
- **Planned at**: `unborn main`, 2026-07-15

## Why this matters

OBS operations are asynchronous, partially successful, and dependent on IDs
returned by prior requests. Mixing diff logic into WebSocket callbacks would
make failure recovery and rapid revision supersession almost impossible to
reason about. A pure, dependency-aware planner can be exhaustively tested
against observed states before any real OBS instance is touched.

## Current state

- Core snapshots provide sources, absolute transforms, crop, visibility, and
  canonical bottom-to-top item order.
- `@react-obs/target-obs` and `@react-obs/testkit` are empty skeletons.
- The current protocol is vendored at `reference/obs-websocket/protocol.md` and
  JSON form at `reference/obs-websocket/protocol.json`.
- V1 permits at most one placement of a source per scene, allowing recovery by
  `(sceneUuid, sourceUuid)` when no local layer manifest exists.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Planner tests | `pnpm --filter @react-obs/target-obs test -- --run planner` | all pass |
| Testkit tests | `pnpm --filter @react-obs/testkit test` | all pass |
| Full gates | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | all exit 0 |

## Suggested executor toolkit

- Read the `GetVersion`, `GetInputKindList`, `CreateScene`, `CreateInput`,
  `CreateSceneItem`, `SetInputSettings`, `SetSceneItemTransform`,
  `SetSceneItemIndex`, `SetSceneItemEnabled`, `RemoveSceneItem`, and `RemoveInput`
  sections of `reference/obs-websocket/protocol.md`.
- Use `reference/obs-websocket-js/source/types.ts` for request/response field
  names, but keep these planner types independent of that client package.

## Scope

**In scope**:

- `packages/target-obs/package.json`
- `packages/target-obs/src/naming.ts`
- `packages/target-obs/src/capabilities.ts`
- `packages/target-obs/src/observed-state.ts`
- `packages/target-obs/src/operations.ts`
- `packages/target-obs/src/plan.ts`
- `packages/target-obs/src/planner.ts`
- `packages/target-obs/src/codecs/{types,image,media,browser,color}.ts`
- `packages/target-obs/src/planner.test.ts`
- `packages/target-obs/src/fixtures/*`
- `packages/target-obs/src/index.ts` for pure public types only
- `packages/testkit/src/fake-obs-state.ts`
- `packages/testkit/src/obs-plan-matchers.ts`
- `packages/testkit/src/index.ts`

**Out of scope**:

- WebSocket connections, retries, event listeners, timers, target status,
  scheduler, command bus, React, DOM, Yoga, audio, filters, transitions, groups,
  scene switching, or deletion of unmanaged resources.

## Git workflow

- Branch: `codex/005-obs-planner`.
- Suggested commit: `feat(obs): plan deterministic scene convergence`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Define managed naming and ownership

Create deterministic names using one documented prefix and the validated
project/scene/source IDs. Include a project-owned registry scene:

```text
react-obs::<projectId>::registry
react-obs::<projectId>::scene::<sceneId>
react-obs::<projectId>::source::<sourceId>
```

New inputs are created disabled in the registry scene; real scene placements are
always separate `CreateSceneItem` operations. This preserves the source versus
placement model despite `CreateInput` requiring a scene. Parsing must reject
near-matches and other project IDs. Human labels never affect managed names.

**Verify**: naming tests round-trip every valid ID and reject unmanaged or
different-project names.

### Step 2: Define normalized observed OBS state

Model protocol query results as maps of canvases/scenes, inputs, and scene items,
plus available requests and input kinds. Include UUIDs, scene-item numeric IDs,
indices, enabled state, transforms, and settings when observed. Carry an
`observationEpoch` so IDs from a prior reconnect or scene-collection change
cannot be reused.

Build a normalization function that classifies managed versus unmanaged
resources. Recover layers by the unique `(managed scene, managed source)` pair.
If duplicates exist, emit `OBS_AMBIGUOUS_PLACEMENT` and do not schedule deletion.

**Verify**: fixture normalization tests cover empty OBS, mixed ownership,
duplicate placements, stale epochs, and another project using the same prefix.

### Step 3: Define symbolic operations and dependency phases

Create a closed `ObsOperation` union with stable operation keys and symbolic
resource references. Include ensure scene/input/placement, update input settings,
set transform, set order, set enabled, remove placement, and remove input.
Separate operations into phases:

1. scenes and registry;
2. inputs;
3. placements;
4. source settings;
5. transforms and crop;
6. order;
7. enable;
8. obsolete placement removal;
9. unreferenced input removal.

Operations in one phase may batch only when all identifiers are already known.
Later phases may reference outputs from earlier symbolic operations. Mark phases
8-9 destructive so the executor can recheck staleness before running them.

**Verify**: type-level exhaustiveness and dependency validation tests reject a
plan with missing, cyclic, forward-in-same-batch, or duplicate operation keys.

### Step 4: Add isolated source codecs

Define `ObsSourceCodec<T>` with capability probing, create settings, update
diffing, and input-kind candidates. Implement image, media-file, browser, and
color codecs. Keep kind-specific settings entirely inside codecs. Probe
available input kinds and requests; do not assume browser source is installed.

Codec output must be deterministic and omit unchanged settings. Asset values are
already OBS-resolved paths supplied to planning context; codecs do not perform
I/O. A missing codec or input kind produces a capability diagnostic, never an
unsafe native settings pass-through.

**Verify**: codec fixture tests assert exact create/update specs for all four
source kinds and explicit unsupported results.

### Step 5: Implement the pure planner

Implement `planObsUpdate({ desired, observed, capabilities, resolvedAssets })`.
It must:

- create registry and managed scenes before dependents;
- create sources disabled in the registry;
- create real placements disabled, then transform/order/enable them;
- skip updates whose normalized desired and observed values are equal;
- invert canonical order exactly once if OBS indices are bottom-based;
- remove obsolete placements before their unreferenced input;
- never emit operations against unmanaged resources;
- suppress destructive work when observed identity is ambiguous;
- produce identical serialized plans for identical inputs.

For a full rebuild, favor harmless managed leftovers over speculative deletion.

**Verify**: planner fixtures cover empty-to-desired, no-op, property update,
reorder, removal, final-reference garbage collection, mixed unmanaged content,
ambiguous placement, unsupported codec, and nested scene placement.

### Step 6: Add an in-memory OBS reducer to the testkit

Implement a fake reducer that applies symbolic operations and deterministic fake
IDs to normalized OBS state. It must model partial execution by stopping after
any operation index and must model `RemoveInput` removing every associated scene
item. Add custom matchers for operation kinds, phase order, and managed-only
touches.

Use this to assert: applying a successful plan to any fixture produces a state
semantically equivalent to desired; planning that result again produces no
operations.

**Verify**: `pnpm --filter @react-obs/testkit test && pnpm --filter @react-obs/target-obs test -- --run planner` -> all pass.

### Step 7: Export only pure planner APIs

Export planner inputs/results, operation types, normalized observed-state types,
codec registration, and naming helpers. Do not export internal mutable maps or
protocol-client classes.

**Verify**: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` -> all pass.

## Test plan

In addition to named fixtures, generate bounded combinations of three scenes,
four sources, visibility changes, reorders, and removals. For each, apply the
plan with the fake reducer and assert convergence plus idempotent replan. Test
every partial-stop point and assert a subsequent observation/replan can converge
without touching unmanaged resources.

## Done criteria

- [x] The planner performs no I/O and imports no client, React, DOM, or Yoga code.
- [x] Every operation has stable identity, dependencies, phase, and destructive flag.
- [x] Empty, update, reorder, removal, partial failure, and no-op cases converge.
- [x] Unmanaged resources are unchanged in every test.
- [x] Ambiguous identities block deletion.
- [x] A converged state replans to zero operations.
- [x] Full repository verification passes.
- [x] `plans/README.md` marks Plan 005 `DONE`.

## STOP conditions

- The current OBS protocol no longer returns input UUID or scene-item ID from
  creation requests.
- A source codec requires undocumented settings that cannot be discovered or
  integration-tested.
- OBS ordering semantics cannot be established with an isolated fixture and a
  planned real-OBS probe.
- Supporting repeated same-source placement becomes necessary.

## Maintenance notes

The planner is safety-critical. Review every new operation for ownership,
idempotency, phase dependencies, staleness, and whether partial success can be
recovered after a fresh observation.

