# Plan 001: Establish the workspace and architecture contracts

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report; do not improvise. When done, update
> this plan's row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git rev-parse --verify HEAD >/dev/null 2>&1 && git diff --stat HEAD -- package.json pnpm-workspace.yaml tsconfig.base.json packages examples docs || git status --short -- package.json pnpm-workspace.yaml tsconfig.base.json packages examples docs`
> This plan was authored before the repository's first commit. If application
> files already exist, compare them with the target structure below and stop on
> an incompatible package layout or toolchain decision.

## Status

- **Priority**: P1
- **Effort**: M (about one day)
- **Risk**: LOW — foundational files only, but every later plan assumes their names
- **Depends on**: none
- **Category**: dx, docs, architecture
- **Planned at**: `unborn main`, 2026-07-15

## Why this matters

The repository has no source, manifest, build command, test command, or recorded
architecture decisions. Establishing one strict workspace and one-command
verification baseline prevents each package from inventing incompatible module,
test, and publishing conventions. The ADRs turn the desired design into durable
constraints an executor can review without this conversation.

## Current state

- The repository contains only `.git/`, `reference/`, and `plans/`.
- `reference/SOURCES.md` records the selected versions: pnpm 11.13.0,
  TypeScript 6.0.3, Vitest 4.1.10, Playwright 1.61.1, React 19.2.7,
  react-reconciler 0.33.0, Yoga 3.2.1, and obs-websocket-js 5.0.8.
- There is no existing naming, formatting, branch, or commit convention.
- Adopt ESM, strict TypeScript, named exports, kebab-case filenames, `*.test.ts`
  colocated unit tests, and no default exports in library packages.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 and create `pnpm-lock.yaml` |
| Build | `pnpm build` | all workspace TypeScript builds exit 0 |
| Typecheck | `pnpm typecheck` | exit 0 with no diagnostics |
| Unit tests | `pnpm test` | Vitest exits 0 |
| Lint | `pnpm lint` | ESLint exits 0 |
| Format | `pnpm format:check` | Prettier exits 0 |

## Suggested executor toolkit

- Read `reference/pnpm/workspaces.md` and
  `reference/typescript/project-config/Project-References.md` before creating
  workspace and TypeScript project files.
- Read `reference/vitest/projects.md` before configuring package test projects.

## Scope

**In scope**:

- Root files: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`,
  `tsconfig.base.json`, `tsconfig.json`, `eslint.config.mjs`,
  `prettier.config.mjs`, `.gitignore`, `README.md`, `AGENTS.md`,
  `vitest.config.ts`.
- Package skeletons under `packages/core`, `packages/react`,
  `packages/target-dom`, `packages/target-obs`, and `packages/testkit`.
- Example skeleton under `examples/studio`.
- `docs/architecture.md`, `docs/compatibility-contract.md`, and ADRs
  `docs/adr/0001-memory-host.md`, `0002-yoga-is-canonical.md`, and
  `0003-exclusive-obs-ownership.md`.
- `plans/README.md` status only.

**Out of scope**:

- Scene graph, Yoga, DOM, OBS, or reconciler implementation.
- Publishing configuration, Changesets, CI, release automation, or a website.
- Editing anything under `reference/`.

## Git workflow

- Branch: `codex/001-workspace-baseline`.
- Use conventional commits; suggested commit: `chore: establish workspace baseline`.
- Do not push or open a pull request unless instructed.

## Steps

### Step 1: Create the pnpm workspace and root scripts

Create the root `package.json` as private ESM, set
`packageManager: "pnpm@11.13.0"`, require Node `>=22`, and add the six commands
from the command table. Use pnpm recursive execution for build/typecheck and one
root Vitest configuration for tests. Add workspace globs for `packages/*` and
`examples/*`.

Pin the documented tool versions exactly. Include ESLint 10.7.0,
`@eslint/js` 10.0.1, `typescript-eslint` 8.64.0, Prettier 3.9.5,
`@types/node` 26.1.1, jsdom 29.1.1, TypeScript 6.0.3, Vitest 4.1.10, and
Playwright 1.61.1 as root development dependencies.

**Verify**: `pnpm install` -> exit 0 and `test -f pnpm-lock.yaml` exits 0.

### Step 2: Establish strict TypeScript project references

Create `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `verbatimModuleSyntax`, declaration and source-map
output, ESM-compatible module resolution, and no implicit emit outside each
package's `dist/`. Create a root solution `tsconfig.json` referencing all five
packages and the example. Each package gets `package.json`, `tsconfig.json`, and
`src/index.ts`; package names are `@react-obs/core`, `@react-obs/react`,
`@react-obs/target-dom`, `@react-obs/target-obs`, and `@react-obs/testkit`.

Declare workspace dependencies with `workspace:*`. Keep all runtime entrypoints
side-effect-free and expose only `dist/index.js` plus declarations.

**Verify**: `pnpm build` -> exit 0 and each package has `dist/index.d.ts`.

### Step 3: Configure lint, format, and unit tests

Use ESLint flat config with TypeScript type-aware rules for source files. Ban
floating promises, unsafe `any`, and default exports in library packages. Allow
test files to use assertion helpers. Configure Prettier once at the root.
Configure Vitest with Node as default environment and include
`packages/**/*.test.ts`; individual DOM tests may opt into jsdom.

Add one trivial exported `PACKAGE_NAME` constant and one test in `core` only to
prove build and test discovery, then remove neither until Plan 002 replaces it.

**Verify**: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` ->
all four commands exit 0 and Vitest reports at least one passing test.

### Step 4: Record the architecture and compatibility contract

Write `docs/architecture.md` with the three representations: mutable authoring
graph, immutable compiled snapshot, and target-specific materialization plan.
Include data flow, package ownership, and the rule that target workers cannot
import React.

Write `docs/compatibility-contract.md` listing the v1 parity guarantees
(canvas coordinates, frame, crop/fit, order, visibility, opacity, rotation) and
explicit non-guarantees (fonts, video timing, browser paint, color management,
audio, filters, capture, and frame-perfect animation).

Each ADR must include status, context, decision, consequences, and rejected
alternatives. Encode the ten invariants from `plans/README.md`.

**Verify**: `rg -l '^## (Context|Decision|Consequences|Rejected alternatives)$' docs/adr/*.md | wc -l` -> prints `3`.

### Step 5: Add contributor and repository guidance

Document setup and verification in `README.md`. Add `AGENTS.md` with package
boundaries, exact commands, source/placement vocabulary, prohibition on
React-to-OBS side effects, and the requirement to update tests with behavior.
Ignore only generated output, coverage, Playwright artifacts, logs, and local
environment files; do not ignore fixtures or golden snapshots.

**Verify**: `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` -> all exit 0.

## Test plan

- Add `packages/core/src/index.test.ts` proving the exported baseline constant is
  visible through the package source.
- Confirm Vitest discovers colocated tests and TypeScript builds all references.
- No behavior tests belong in this plan.

## Done criteria

- [x] All six root commands exist and pass.
- [x] `pnpm-lock.yaml` is present and uses the pinned versions.
- [x] All five packages and the example participate in TypeScript references.
- [x] Three ADRs and the compatibility contract exist.
- [x] `AGENTS.md` states the package and asynchronous-boundary rules.
- [x] No implementation beyond the baseline constant exists.
- [x] `plans/README.md` marks Plan 001 `DONE`.

## STOP conditions

- Application source or a conflicting package manager already exists.
- TypeScript 6.0.3 or the pinned tools do not support the available Node runtime.
- A dependency requires CommonJS-only package output.
- Passing verification requires weakening strictness or lint safety rules.

## Maintenance notes

Upgrade React and `react-reconciler` only as a tested pair. Keep the root scripts
stable because every later plan and CI workflow treats them as acceptance gates.
