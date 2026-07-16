# Repository guidance

## Commands

- Install: `pnpm install`
- Build: `pnpm build`
- Typecheck: `pnpm typecheck`
- Unit tests: `pnpm test`
- Lint: `pnpm lint`
- Format check: `pnpm format:check`

Run all six before declaring a plan complete unless the operator explicitly prioritizes
implementation progress over full verification.

## Architecture boundaries

- `core` may not import React, DOM, Yoga target objects, OBS protocol clients, or target packages.
  Yoga itself is wrapped internally by core's layout compiler.
- `react` may import React, react-reconciler, and core. It may not import target implementations or
  perform remote I/O.
- Targets consume immutable core snapshots. They never inspect React fibers or authoring host nodes.
- The OBS planner is a pure data transformation. Transport and retries live outside it.
- Testkit can depend on public contracts but production packages must not depend on testkit.

## Vocabulary

- A **source** is one reusable image, media, browser, color, or target-native resource definition.
- A **layer** is one placement of a source in a scene.
- A **box** is a virtual Yoga layout container and is not an OBS object.
- An **authoring graph** is the local tree React mutates.
- A **compiled snapshot** is immutable, target-neutral plain data with a revision.
- A **target plan** is a DOM patch or dependency-aware OBS operation plan.

## Non-negotiable invariants

1. React host methods perform only synchronous local mutation.
2. Yoga owns common layout; DOM CSS does not independently lay out the scene.
3. Explicit IDs, never React keys, identify remote resources.
4. OBS resources outside the project's managed namespace are never modified.
5. Async target errors are observable target state, not delayed React exceptions.
6. Stable desired state and one-shot commands remain separate.

## Code conventions

- ESM, strict TypeScript, named exports, kebab-case filenames.
- Prefer closed discriminated unions and readonly public data. "Readonly" means types (`readonly`
  properties, `as const`), not runtime freezing. Reserve `Object.freeze`/`deepFreeze` for data
  crossing the user→authoring or core→target boundary: compiled snapshots, cloned authoring inputs,
  and frame definitions. Do not freeze internal or same-process trusted data.
- No string-indexed settings bags in core public APIs.
- Errors at authoring boundaries become deterministic diagnostics where possible.
- Add or update behavior tests with implementation changes, but prioritize the correct abstraction
  over test-shaped production APIs.
