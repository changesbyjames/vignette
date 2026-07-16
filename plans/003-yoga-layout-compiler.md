# Plan 003: Compile deterministic layout snapshots with Yoga

> **Executor instructions**: Follow every step and verification gate. Assume
> Plans 001 and 002 are complete. Do not add target behavior to solve layout
> mismatches. Update the plan index when complete.
>
> **Drift check (run first)**: `git diff --stat HEAD -- packages/core`
> Stop if `LayoutStyle`, `CompiledSnapshot`, or content-placement types no longer
> match Plan 002's neutral contracts.

## Status

- **Priority**: P1
- **Effort**: L (three to five days)
- **Risk**: MED — rounding or fit mistakes create visible cross-target drift
- **Depends on**: `plans/002-neutral-scene-graph.md`
- **Category**: architecture, correctness, tests
- **Planned at**: `unborn main`, 2026-07-15

## Why this matters

Both DOM and OBS must consume exactly the same fixed-canvas geometry. Allowing
the browser to perform independent CSS layout would produce different defaults,
intrinsic measurements, and rounding. A deterministic compiler turns the
validated authoring graph into absolute rectangles and explicit content crop,
making parity measurable and target adapters mechanical.

## Current state

- `@react-obs/core` defines graph, snapshot, geometry, validation, and builders.
- `LayoutStyle` is a narrow placeholder with no Yoga runtime dependency.
- The selected runtime is `yoga-layout@3.2.1`.
- Yoga must be configured explicitly; read
  `reference/yoga/docs/getting-started/configuring-yoga.mdx` and
  `reference/yoga/docs/advanced/incremental-layout.mdx`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Core tests | `pnpm --filter @react-obs/core test` | all pass |
| Layout tests | `pnpm --filter @react-obs/core test -- --run layout` | golden cases pass |
| Full gates | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | all exit 0 |

## Scope

**In scope**:

- `packages/core/package.json`
- `packages/core/src/authoring.ts`
- `packages/core/src/layout/style.ts`
- `packages/core/src/layout/yoga-runtime.ts`
- `packages/core/src/layout/content-fit.ts`
- `packages/core/src/layout/rounding.ts`
- `packages/core/src/layout/compile-layout.ts`
- `packages/core/src/layout/compile-layout.test.ts`
- `packages/core/src/layout/content-fit.test.ts`
- `packages/core/src/layout/fixtures/*`
- `packages/core/src/index.ts`
- Clarifications in `docs/compatibility-contract.md`

**Out of scope**:

- DOM CSS, OBS transforms, async intrinsic measurement, text measurement,
  animations, Grid, arbitrary CSS, target-specific layout engines, or workers.

## Git workflow

- Branch: `codex/003-yoga-compiler`.
- Suggested commit: `feat(core): compile deterministic yoga layout`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Complete the supported layout language

Define explicit serializable values for width/height, min/max dimensions,
aspect ratio, margin, padding, gap, flex direction/grow/shrink/basis,
justify/align, absolute position/insets, and overflow clipping. Support points,
percentages, and `auto` only where Yoga has unambiguous support. Do not accept
raw CSS strings or camel-case pass-through records.

Set project defaults explicitly: left-to-right direction, column flex direction,
`box-sizing: border-box`-equivalent sizing, zero point scale factor during raw
calculation, and a documented final pixel-rounding policy. Do not inherit Yoga
version defaults silently.

**Verify**: `pnpm typecheck` -> every style property is a closed union without a
string index signature.

### Step 2: Wrap Yoga allocation and disposal

Implement one adapter translating `LayoutStyle` into Yoga calls. Keep Yoga node
creation, config, child insertion, calculation, and recursive `free()` inside
`yoga-runtime.ts`. A failed compile must still free all allocated nodes.

Do not expose Yoga nodes publicly or retain them in compiled snapshots. Add a
test seam that counts allocations and frees so success and validation failure
both finish at zero live nodes.

**Verify**: `pnpm --filter @react-obs/core test -- --run layout` -> lifecycle
tests show allocations equal frees.

### Step 3: Compile boxes and flatten placements

Build the Yoga tree from scenes and virtual boxes. After calculation, accumulate
ancestor offsets and clipping rectangles, then flatten only layer/scene-layer
leaves into `CompiledItem` records. Boxes must never become compiled target
resources. Preserve canonical logical child order as bottom-to-top.

Resolve percentages against the containing block. Fail with a diagnostic when
a percentage or flex item depends on an unbounded dimension. Use a stable
depth-first traversal and reject non-finite computed values.

**Verify**: fixture tests for nested boxes, flex rows/columns, absolute children,
percentages, padding, gap, and clipping assert exact compiled rectangles.

### Step 4: Implement shared content fitting

Given a destination frame, declared source size/aspect, fit mode (`contain`,
`cover`, `fill`), alignment, and manual crop, return explicit destination and
source-crop data. Handle zero dimensions as diagnostics. Specify rounding before
calculating crop so DOM and OBS do not round independently.

Test landscape-to-portrait and portrait-to-landscape contain/cover, odd pixel
sizes, non-central alignment, fill distortion, and manual crop composition.

**Verify**: `pnpm --filter @react-obs/core test -- --run content-fit` -> all
table-driven cases pass with exact rectangles/insets.

### Step 5: Add revisioned graph compilation

Expose `compileBroadcast(graph, { revision, targetSelection? })`. It first runs
validation, then layout, then content fitting, returning either an immutable
snapshot plus warnings or an error diagnostic set. Freeze snapshot collections
in development/test builds. The same graph and revision must serialize to the
same JSON bytes across repeated runs.

Target selection may replace a branch with its explicit fallback, but common
nodes must retain identical frames. Emit a diagnostic if target selection would
change common flex participation.

**Verify**: compile the same fixtures 100 times and assert identical serialized
output; compile DOM and OBS selections and assert common layer frames match.

### Step 6: Establish layout golden fixtures

Store small human-readable input and expected-output fixtures under
`layout/fixtures/`; do not use opaque Vitest snapshots for geometry. Cover a
1920x1080 broadcast with background, two-column media/browser content, padding,
gap, overlay, clipping, child reorder, and nested scene placement.

**Verify**: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` -> all pass.

## Test plan

Tests must cover the complete supported style matrix, allocation cleanup,
deterministic serialization, canonical order, fit/crop math, nested offsets,
clipping, target fallbacks, and unbounded/invalid dimensions. Each bug found in
future layout work should first become a minimal golden fixture.

## Done criteria

- [x] Yoga is the only layout engine used by the compiler.
- [x] No Yoga node escapes `yoga-runtime.ts` or survives a compile.
- [x] Compiled items contain absolute frames and explicit crop data.
- [x] The same graph produces byte-identical serialized geometry repeatedly.
- [x] DOM/OBS target selection preserves common frames.
- [x] Full repository verification passes.
- [x] `plans/README.md` marks Plan 003 `DONE`.

## STOP conditions

- Yoga 3.2.1 behavior differs from a required documented style semantic.
- A desired feature requires asynchronous intrinsic measurement.
- Target-only branches cannot preserve common layout without a new public rule.
- A rounding decision cannot be represented identically in DOM and OBS.

## Maintenance notes

Yoga configuration and pixel rounding are compatibility surface. Any change to
either requires updating explicit fixtures and visual parity baselines, not just
unit snapshots.
