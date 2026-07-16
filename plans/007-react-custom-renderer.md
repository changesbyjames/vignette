# Plan 007: Add the React custom renderer and root API

> **Executor instructions**: Add React only after the graph and target contracts
> are proven. The host config may mutate local host nodes but must never call a
> target, resolve an asset, perform layout, or start asynchronous work during
> render. Run every verification gate and update the plan index.
>
> **Drift check (run first)**:
> `git diff --stat HEAD -- packages/core packages/react packages/testkit`

## Status

- **Priority**: P1
- **Effort**: L (four to six days)
- **Risk**: HIGH — react-reconciler is experimental and render/commit boundaries are subtle
- **Depends on**: `plans/002-neutral-scene-graph.md`, `plans/006-obs-async-convergence.md`
- **Category**: direction, architecture, tests
- **Planned at**: `unborn main`, 2026-07-15

## Why this matters

The custom renderer supplies the desired React authoring experience while
keeping the tested compiler and target state machines independent. Its job is
deliberately small: build a local tree, publish one revision after a completed
commit, and expose commit/target settlement without pretending asynchronous OBS
work is part of React's commit. This boundary also protects against abandoned
concurrent render work causing external side effects.

## Current state

- Core defines authoring nodes, compiler, targets, revisions, and diagnostics.
- DOM and OBS targets consume snapshots independently.
- The exact supported pair is `react@19.2.7` and
  `react-reconciler@0.33.0`; matching docs are under
  `reference/react-reconciler/`.
- `createInstance` and initial child assembly occur during render and therefore
  cannot mutate the committed root or perform side effects.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Renderer tests | `pnpm --filter @react-obs/react test` | all pass |
| Host tests | `pnpm --filter @react-obs/react test -- --run host` | all mutation cases pass |
| Full gates | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | all exit 0 |

## Suggested executor toolkit

- Read all of `reference/react-reconciler/README.md`.
- Treat `reference/react-reconciler/source/ReactFiberConfig.custom.js` as the
  authoritative export checklist for the pinned line.
- Use `@types/react-reconciler@0.33.0`; do not copy a host config from a tutorial
  targeting another React version.

## Scope

**In scope**:

- `packages/react/package.json`
- `packages/react/src/host-types.ts`
- `packages/react/src/host-tree.ts`
- `packages/react/src/host-config.ts`
- `packages/react/src/reconciler.ts`
- `packages/react/src/root.ts`
- `packages/react/src/primitives.tsx`
- `packages/react/src/status.ts`
- `packages/react/src/*.test.tsx`
- `packages/react/src/index.ts`
- `packages/testkit/src/fake-target.ts`
- `packages/testkit/src/index.ts`
- Version note in `docs/architecture.md`

**Out of scope**:

- ReactDOM preview rendering, controls UI, OBS calls, asset I/O, layout inside
  host methods, Suspense for target settlement, portals across renderers,
  one-shot command hooks, or a second React root per target.

## Git workflow

- Branch: `codex/007-react-renderer`.
- Suggested commit: `feat(react): reconcile scenes into the neutral graph`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Pin the renderer dependency pair

Add exact runtime dependencies `react@19.2.7` and
`react-reconciler@0.33.0`, and development types `@types/react@19.2.17` and
`@types/react-reconciler@0.33.0`. Declare React as a peer dependency for the
published package while retaining the exact workspace development dependency.
Document the tested pair in `docs/architecture.md`.

**Verify**: `pnpm install && pnpm why react react-reconciler` -> one compatible
React line and reconciler 0.33.0 are resolved for the package.

### Step 2: Implement side-effect-free host nodes

Define local mutable host nodes containing generated ephemeral host identity,
primitive type, sanitized props, parent, and ordered children. Persistent remote
identity comes only from explicit scene/source/layer IDs in props. Implement
attach, insert-or-move, detach, update, and recursive conversion to the public
authoring graph with invariant checks.

`createInstance` may mutate only the newly-created node. Initial child methods
may assemble the uncommitted subtree. No method may import a target package.

**Verify**: host-tree unit tests cover append, move, insert-before, detach,
double-parent prevention, reorder, prop sanitization, and graph conversion.

### Step 3: Implement the pinned mutation-mode host config

Create the complete host config required by 0.33.0 with `supportsMutation: true`,
no persistence or hydration, microtask scheduling, default event priority, and
all unsupported feature hooks explicitly implemented as no-ops or documented
false values according to the vendored export surface and installed types.

Implement commit methods as local mutation only. `prepareForCommit` records that
a commit is active. `resetAfterCommit` increments the root commit revision and
notifies the root scheduler; it does not compile inline, await, or call targets.
Do not derive identity from React's opaque internal handle.

**Verify**: `pnpm --filter @react-obs/react test -- --run host-config` -> mount,
update, reorder, remove, unmount, fragment, conditional, and StrictMode cases pass.

### Step 4: Compile and publish completed commits

The root scheduler coalesces completed commits in one microtask. It converts the
latest committed host tree to an authoring graph, compiles it synchronously on
the single JS thread, and publishes the immutable snapshot to every attached
target. If commits 4-6 arrive before compilation, compile only tree 6 with
revision 6; commit waiters for 4-5 resolve as superseded by the later successful
compile.

Compilation diagnostics update root status. Invalid graphs publish nothing and
leave targets at their previous settled snapshot. An OBS target failure cannot
prevent a DOM target from receiving a valid snapshot.

**Verify**: fake-target tests cover coalescing, independent target failure,
invalid commit, later repair, attach after existing snapshot, and target detach.

### Step 5: Expose root commit and settlement semantics

Implement `createBroadcastRoot({ projectId, canvas, unsupported })` returning:

- `render(element): Promise<CommitReceipt>` resolving after local commit and
  successful compilation, never after remote settlement;
- `attachTarget(target)` and `detachTarget(id)`;
- `whenSettled(targetId, revision)` delegating to the target;
- `getSnapshot()` and subscribable root status;
- `unmount()` and `dispose()` with distinct semantics.

A later compiled revision may satisfy an earlier superseded commit promise, but
the receipt must state both requested and compiled revision. Do not call this API
`createRoot` alone; avoid confusion with ReactDOM.

**Verify**: public API tests assert timing precisely using manual targets and a
fake clock.

### Step 6: Build ergonomic React primitives

Export typed components `Broadcast`, `Sources`, `Scene`, `Box`, `Layer`,
`SceneLayer`, `ImageSource`, `MediaSource`, `BrowserSource`, `ColorSource`, and
`Target`. Each returns a private intrinsic host tag and performs no effects.
Require IDs as props where remote identity exists. Keep labels separate.

Add development warnings for a React `key` without the required explicit ID,
but never read or serialize the key. Compound convenience components that both
declare source and placement are deferred until the underlying API is proven.

**Verify**: render a representative JSX scene and assert the exact neutral graph
and compiled snapshot match direct core builders.

### Step 7: Test concurrent and lifecycle boundaries

Test render work that throws before commit, StrictMode behavior, rapid updates,
conditional removal, keyed reorder, target attach/detach, unmount, compile error,
and disposal. Assert that fake target call count changes only after completed
commits and that no abandoned render publishes.

**Verify**: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` -> all pass.

## Test plan

Use fake targets; never connect OBS. Compare React-produced authoring graphs with
direct builder graphs for the same scene. Explicitly count publication around
render errors and StrictMode. Assert host config module imports only React,
react-reconciler, and local/core modules using an import-boundary test or lint
rule.

## Done criteria

- [x] React and reconciler are pinned to the documented compatible pair.
- [x] Host render/commit methods perform only local synchronous mutation.
- [x] One React root feeds all attached targets.
- [x] Compilation and target errors are isolated and observable.
- [x] Commit versus target settlement semantics are tested and documented.
- [x] JSX primitives require explicit persistent IDs.
- [x] Abandoned render work never publishes.
- [x] Full repository verification passes.
- [x] `plans/README.md` marks Plan 007 `DONE`.

## STOP conditions

- Installed 0.33.0 host-config types disagree with vendored 19.2 source exports.
- Satisfying the host config requires `any`, `@ts-ignore`, or reading React's
  opaque internal handle.
- A requested primitive requires arbitrary DOM children or OBS settings objects.
- Compilation cannot be safely coalesced without observing a partly-mutated tree.

## Maintenance notes

Keep the host config isolated so React upgrades touch one high-risk module.
Review any asynchronous code added to this package for whether it accidentally
moves target convergence into React's commit semantics.

