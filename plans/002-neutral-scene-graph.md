# Plan 002: Implement the neutral scene graph and validation

> **Executor instructions**: Execute every step and gate in order. This plan is
> self-contained but assumes Plan 001 is complete. Stop on any STOP condition
> rather than broadening the model. Update `plans/README.md` when finished.
>
> **Drift check (run first)**:
> `git diff --stat HEAD -- packages/core docs/compatibility-contract.md`
> Compare the package skeleton and architecture vocabulary with this plan. Stop
> if the package has acquired a different public model.

## Status

- **Priority**: P1
- **Effort**: L (two to four days)
- **Risk**: MED — these public identities and unions constrain every target
- **Depends on**: `plans/001-workspace-and-contracts.md`
- **Category**: direction, architecture, tests
- **Planned at**: `unborn main`, 2026-07-15

## Why this matters

The neutral graph is the boundary that prevents React, DOM, Yoga, and OBS from
leaking into one another. It must make invalid references, duplicate identities,
cycles, unsupported layout participation, and ambiguous repeated placements
explicit before a target performs side effects. Stable plain-data types also
make snapshots serializable and planner tests cheap.

## Current state

After Plan 001, `@vignette/core` is an empty strict TypeScript package. The
required vocabulary is:

- **source**: one reusable media/input definition.
- **scene**: a named compositing root.
- **layer**: one placement referencing a source or nested scene.
- **box**: a virtual layout container; it is not necessarily a target object.
- **authoring graph**: mutable host-facing representation.
- **compiled snapshot**: immutable, validated plain data carrying a revision.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Core tests | `pnpm --filter @vignette/core test` | all core tests pass |
| Typecheck | `pnpm typecheck` | no diagnostics |
| Full gates | `pnpm lint && pnpm test && pnpm build` | all exit 0 |

## Suggested executor toolkit

- Use `reference/typescript/handbook/Type-Declarations.md` for discriminated
  union and declaration-export guidance.
- Re-read `docs/compatibility-contract.md` before exposing target-specific props.

## Scope

**In scope**:

- `packages/core/src/ids.ts`
- `packages/core/src/geometry.ts`
- `packages/core/src/assets.ts`
- `packages/core/src/capabilities.ts`
- `packages/core/src/sources.ts`
- `packages/core/src/authoring.ts`
- `packages/core/src/snapshot.ts`
- `packages/core/src/diagnostics.ts`
- `packages/core/src/validation.ts`
- `packages/core/src/validation.test.ts`
- `packages/core/src/builders.ts`
- `packages/core/src/index.ts`
- `docs/compatibility-contract.md` only for clarifications discovered here

**Out of scope**:

- React elements, hooks, contexts, JSX declarations, DOM nodes, Yoga imports,
  OBS protocol objects, transport, asset copying, or one-shot commands.
- Native text, audio routing, filters, transitions, groups, and capture sources.

## Git workflow

- Branch: `codex/002-neutral-scene-graph`.
- Suggested commit: `feat(core): define neutral scene graph`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Define branded identities and geometry

Create opaque branded string types `ProjectId`, `SceneId`, `SourceId`, and
`LayerId` with validating constructor functions. IDs must be non-empty,
trimmed, stable strings limited to `[A-Za-z0-9._-]`; labels remain unrestricted
human-facing strings. Define immutable `Rect`, `Size`, `Insets`, and normalized
alignment types. Reject non-finite values and negative dimensions.

**Verify**: `pnpm --filter @vignette/core test -- --run validation` -> ID and
geometry cases pass.

### Step 2: Define source definitions and logical assets

Implement a discriminated `SourceDefinition` union for v1 image, media-file,
browser, and color sources. Every source has `id`, optional `label`, and a
logical configuration. Files use `AssetRef { kind: "asset"; path: string }`,
not machine paths. Browser sources require an absolute HTTP(S) URL and explicit
viewport size. Media declares loop/mute as stable state but contains no restart
or seek trigger.

Define `AssetResolver` as an async target-owned interface, but do not implement
one. Validate asset paths as normalized project-relative POSIX paths without
`..`, a leading slash, drive prefix, or URL scheme.

**Verify**: `pnpm --filter @vignette/core test -- --run validation` -> valid
source examples pass and invalid paths/URLs/dimensions produce named diagnostics.

### Step 3: Define the authoring graph

Represent authoring nodes as plain discriminated objects: `BroadcastNode`,
`SourcesNode`, `SceneNode`, `BoxNode`, `LayerNode`, `SceneLayerNode`, and
`TargetNode`. A layer references exactly one `SourceId`; a scene layer references
exactly one `SceneId`. A `BoxNode` carries only the narrow common `LayoutStyle`
shape, initially declared in `authoring.ts` and completed by Plan 003.

`TargetNode` records `only: "dom" | "obs"` plus a child and optional fallback.
Validation must require a fallback or absolute positioning whenever a
target-specific child could otherwise participate in common flex flow.

Do not encode parent pointers in the public graph. Keep child arrays readonly.

**Verify**: `pnpm typecheck` -> unions are exhaustive without `any` or casts at
public boundaries.

### Step 4: Define compiled snapshot and target contracts

Create immutable `CompiledSnapshot`, `CompiledScene`, `CompiledSource`, and
`CompiledItem` types. A snapshot contains revision, project ID, canvas, sources,
scenes, canonical bottom-to-top item order, absolute frame, content placement,
visibility, opacity, and rotation. It must be JSON-serializable; add a type-level
or runtime test that `JSON.stringify` succeeds without custom replacers.

Define `TargetCapabilities`, `UnsupportedPolicy`, `RenderTarget`,
`TargetApplyReceipt`, and status values. `RenderTarget.publish(snapshot)` is
synchronous enqueueing; `whenSettled(revision)` is asynchronous and a later
applied revision satisfies an earlier wait.

**Verify**: `pnpm --filter @vignette/core test -- --run validation` -> snapshot
serialization and target receipt tests pass.

### Step 5: Implement deterministic validation

Return diagnostics as data; do not throw for ordinary user graph mistakes.
Each diagnostic has stable code, severity, message, path, and optional related
IDs. Add validation for:

- duplicate scene, source, and layer IDs;
- missing source/scene references;
- nested-scene cycles;
- invalid canvas or layout numbers;
- repeated placement of one source in one scene (`V1_REPEATED_PLACEMENT`);
- target-only flex participation without a layout-equivalent fallback;
- unreachable sources as warnings, not errors;
- browser URL and asset path constraints.

Sort diagnostics deterministically by path then code. Compilation must be
blocked only by error-severity diagnostics.

**Verify**: `pnpm --filter @vignette/core test -- --run validation` -> every
listed diagnostic has a named test and stable expected code/path.

### Step 6: Add test-only graph builders and exports

Create terse typed builders for tests (`broadcast`, `scene`, `box`, `layer`,
and source builders). They belong in `builders.ts` but export from the explicit
`@vignette/core/builders` package subpath, not the main runtime entrypoint.
Export the production public surface from `index.ts` without leaking mutable
implementation types.

**Verify**: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` -> all pass.

## Test plan

Add table-driven tests for valid minimal graphs and each diagnostic. Include
empty graphs, deeply nested boxes, duplicate IDs in different scenes, missing
references, direct and indirect scene cycles, non-finite numbers, asset
traversal, target branches, and deterministic ordering. Assert the exact
diagnostic code and path, not full prose messages.

## Done criteria

- [x] Public graph and snapshot types contain no React, Yoga, DOM, or OBS types.
- [x] Source and placement identities are separate and explicitly branded.
- [x] Every invalid state listed in Step 5 has a deterministic test.
- [x] Snapshots are immutable plain data and JSON serializable.
- [x] One source cannot appear twice in one scene in v1.
- [x] All root verification commands pass.
- [x] `plans/README.md` marks Plan 002 `DONE`.

## STOP conditions

- A required v1 source cannot be represented without target-specific settings
  in the neutral union; report the source and proposed codec boundary.
- Validation requires reading DOM or OBS state.
- Repeated same-source placement is required for the first demonstrator.
- Implementing target branches would require React conditional rendering.

## Maintenance notes

Treat public ID rules and discriminated-union tags as versioned API. Reviewers
should reject convenience props that smuggle CSS, OBS settings objects, or
one-shot commands into the core declarative model.

