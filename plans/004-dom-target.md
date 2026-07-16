# Plan 004: Materialize compiled snapshots in the DOM

> **Executor instructions**: Follow this plan after Plan 003. The DOM target is
> a materializer for compiled data, not an alternate React renderer or layout
> engine. Stop if implementation requires recomputing layout.
>
> **Drift check (run first)**:
> `git diff --stat HEAD -- packages/core packages/target-dom`

## Status

- **Priority**: P1
- **Effort**: M (two to three days)
- **Risk**: MED — media lifecycle and crop mapping can create parity drift
- **Depends on**: `plans/003-yoga-layout-compiler.md`
- **Category**: direction, correctness, tests
- **Planned at**: `unborn main`, 2026-07-15

## Why this matters

The browser preview is the fastest way to inspect scenes, but it must show the
compiled broadcast canvas rather than a separate responsive CSS interpretation.
An imperative DOM target keeps the scene declaration evaluated once and makes
preview updates independent of ReactDOM. It also establishes the target contract
before the slower OBS target is connected.

## Current state

- `@vignette/core` publishes immutable absolute-layout snapshots.
- `@vignette/target-dom` is an empty package depending on core.
- The target must support image, media-file, browser, and color sources.
- Arbitrary interactive React components are control UI, not broadcast layers.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| DOM tests | `pnpm --filter @vignette/target-dom test` | all jsdom tests pass |
| Typecheck | `pnpm typecheck` | no diagnostics |
| Full gates | `pnpm lint && pnpm test && pnpm build` | all exit 0 |

## Scope

**In scope**:

- `packages/target-dom/package.json`
- `packages/target-dom/src/create-dom-target.ts`
- `packages/target-dom/src/dom-target.ts`
- `packages/target-dom/src/stage.ts`
- `packages/target-dom/src/patch.ts`
- `packages/target-dom/src/media-registry.ts`
- `packages/target-dom/src/elements/{image,media,browser,color}.ts`
- `packages/target-dom/src/styles.ts`
- `packages/target-dom/src/dom-target.test.ts`
- `packages/target-dom/src/index.ts`

**Out of scope**:

- ReactDOM, hooks, layout calculation, arbitrary CSS, text, audio controls,
  browser-source page hosting, asset deployment, or visual screenshot testing.

## Git workflow

- Branch: `codex/004-dom-target`.
- Suggested commit: `feat(dom): materialize compiled scene snapshots`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Create a fixed-resolution stage

Implement `createDomTarget({ container, assetResolver, sceneId })`. Create one
stage element with fixed pixel width/height, `position: relative`, hidden
overflow, isolation, and transform origin at top left. Use a wrapper or resize
observer to apply one preview scale; never alter child broadcast coordinates.

Set stable `data-vignette-*` attributes for project, scene, source, layer, and
revision so tests and devtools do not depend on CSS classes.

**Verify**: DOM unit test asserts a 1920x1080 snapshot creates a 1920x1080 stage
and scaling changes only the outer transform.

### Step 2: Materialize source elements

Create one element implementation per source codec:

- image -> `img` with resolved URL and non-draggable behavior;
- media -> `video` with resolved URL, loop/mute state, and explicit plays-inline;
- browser -> sandboxed `iframe` using the declared URL and viewport contract;
- color -> `div` with validated CSS color.

Elements must fill their placement wrapper; apply the compiler's explicit
destination/crop transform rather than invoking independent `object-fit` logic.
Do not autoplay sound. Surface media promise failures through target status.

**Verify**: jsdom tests assert element type, stable attributes, source reuse, and
settings updates without replacing an unchanged element.

### Step 3: Patch by stable layer identity

Maintain maps from scene/layer IDs to wrappers and source IDs to shared media
records. On publish, create/update/move/remove by explicit IDs. Apply absolute
left/top/width/height, crop clip, opacity, rotation, visibility, and canonical
bottom-to-top DOM order. Changing a label must not replace an element.

Layer removal must release only that placement; release a source element or
media listener only after its final placement disappears.

**Verify**: tests publish revisions covering prop update, reorder, layer remove,
source remove, and label change; node identity is preserved where expected.

### Step 4: Implement latest-wins settlement and disposal

DOM application may be synchronous, but it must implement the common
`RenderTarget` status and `whenSettled(revision)` contract. Coalesce snapshots
published within one microtask to the newest revision. A waiter for revision 4
resolves when revision 5 is applied. `dispose()` removes observers, listeners,
elements, pending work, and rejects future publishes with a typed error.

**Verify**: fake-timer tests publish revisions 1-10 in one turn, assert only 10
materializes, older waiters resolve, and disposal leaves no container children.

### Step 5: Add diagnostics without throwing into producers

Asset resolution and media failures update target status and invoke an optional
error callback. They must not throw asynchronously into React or mutate the
compiled snapshot. An unsupported source obeys the snapshot's explicit policy;
default development behavior is an error diagnostic.

**Verify**: rejected resolver and invalid scene selection tests report stable
target errors and leave the previous settled DOM intact.

### Step 6: Export the public target factory

Export only the factory, configuration/status types, and testing data attributes.
Keep patch maps and DOM codec internals private.

**Verify**: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` -> all pass.

## Test plan

Use jsdom for structural behavior. Cover all four source types, absolute geometry,
crop wrapper shape, ordering, identity-preserving updates, reference cleanup,
microtask coalescing, errors, waiters, and disposal. Pixel parity belongs to
Plan 008 because jsdom does not lay out or paint.

## Done criteria

- [x] DOM performs no flexbox or geometry calculation.
- [x] All children use compiler-provided fixed-canvas values.
- [x] Stable layer IDs drive create/update/move/remove operations.
- [x] Rapid publishes coalesce and settlement is revision-aware.
- [x] Disposal removes every observer, listener, and DOM node.
- [x] Full repository verification passes.
- [x] `plans/README.md` marks Plan 004 `DONE`.

## STOP conditions

- A compiled item lacks enough information to reproduce crop/fit without CSS
  layout; extend core in Plan 003's vocabulary rather than guessing here.
- Browser-source sandboxing prevents a required v1 URL from loading.
- Shared media-element reuse makes two placements observably interfere; retain
  the v1 one-placement-per-scene rule and report the cross-scene case.
- DOM target implementation begins importing React or Yoga.

## Maintenance notes

Reviewers should inspect media listener cleanup and verify no DOM measurement is
fed back into common layout. Browser and OBS Chromium rendering may still differ;
the compatibility promise is geometry, not identical browser-engine paint.

