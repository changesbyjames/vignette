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

## Plumbing delegation

- Delegate routine operational work to the `plumbing` subagent by default. This includes installs,
  builds, tests, typechecks, linting, format checks, long-running or polling CLI commands, waiting
  for command results, and browser interaction.
- Batch related verification commands into one plumbing task when practical, and preserve any
  operator-supplied command arguments and ordering exactly.
- Keep implementation, source edits, architectural decisions, and substantive failure diagnosis in
  the primary agent. Use the plumbing agent to execute commands and return exact results and
  actionable diagnostics.

## Architecture boundaries

Everything ships as one package, `packages/vignette` (npm `@strangecyan/vignette`), with subpath
exports `.`, `./react`, `./dom`, `./obs`, `./obs/testing`, `./frame`, `./frame/mount`, `./bundle`,
`./vite` and `./yoga.wasm`, and the `vignette` bin (`src/cli`, not an export: importing it runs the
CLI). `vite` and `playwright` are optional peer dependencies: only `bundle`, `vite` and the `dev`,
`build` and `preview` commands use them, and they import them lazily (`loadVite()`,
`import("playwright")`), so `@strangecyan/vignette` and `@strangecyan/vignette/obs` load without
either. Environment separation is enforced per directory of `packages/vignette/src/` by
`no-restricted-imports` rules in `oxlint.config.ts`, not by package boundaries:

- `core` (data model, `defineSource`, built-in source definitions, layout compiler), `stream`
  (messages, hub, SSE codec), `compose` (the composer), `react-authoring` (show primitives and the
  reconciler host config) and `target` (the target kernel and plugin contracts) are
  environment-neutral. They may import `react`, `react-reconciler`, `yoga-layout` and `zod`, and
  each other. They may not import `node:*` or Node built-ins, `react-dom`, `obs-websocket-js`,
  `playwright`, `vite`, `@tanstack/react-query`, or anything under `obs`, `dom`, `react`, `frame`,
  `bundle`, `vite` or `cli`.
- `obs` (the OBS target) may not import `dom` or `react`.
- `dom` and `react` (browser targets) may not import `obs` or Node built-ins.
- `frame`, `bundle`, `vite` and `cli` sit on top and may import the directories they need.
  `@strangecyan/vignette/frame` exports only `frame()`, because shows import it in Node;
  `mountFrames` lives in `@strangecyan/vignette/frame/mount` and is imported only by the generated
  `frames.js` entry.
- Clients know nothing about shows, scenes or frames. The React client, the DOM target, the dev
  preview page and `vignette preview` render a `Frame` source as an iframe to the frame page and
  import no frame modules; `frames.js` is the only bundle containing frame components.
- Tests (`*.test.ts[x]`) are exempt from the import rules.

Targets consume immutable snapshots; they never inspect React fibers or host nodes. The OBS planner
is a pure data transformation; transport and retries live outside it.
`@strangecyan/vignette/obs/testing` (`FakeObs`, `ManualClock`) exists for tests; production code
never imports it.

`packages/moq` (`@strangecyan/vignette-moq`) and `examples/*` use only `@strangecyan/vignette`'s
public entries, like any other consumer.

## Vocabulary

- A **show** is the React tree rooted at `<Show id canvas activeScene?>`: scenes (`<Scene>`), layers
  (`<Layer>`), source components, and `<Use>` placements of shared sources.
- A **source** is one instance of a source kind (`Color`, `Image`, `Video`, `Browser`, `Frame`,
  `Text`, or any `defineSource`): `{ id, kind, props, size }` in a snapshot. An inline source
  belongs to its layer; a shared source is declared at show level with an `id`.
- A **layer** either places one source (becoming one snapshot **item**) or groups other layers for
  Yoga layout (virtual; never a target object).
- A **snapshot** is immutable, target-neutral plain data with a revision, validated by
  `SnapshotSchema`.

The pipeline is **composer → stream → target**; use these names consistently in code and docs:

- The **composer** runs the show in React (`compose`), compiles each commit into a snapshot and
  publishes the stream. It never knows what targets exist.
- The **stream** is the ordered `setup` / `update` / `event` messages a composer publishes
  (`StreamMessage`). Setup carries `{ id, canvas, kinds, assets, serve }`; it is the only channel
  from composer to anything.
- A **target** renders snapshots in one medium (React, DOM, OBS, or a custom one from
  `createTarget`) and reports `TargetStatus`, the one status shape: `phase`, `revision`, `assets`,
  per-source state and `sourceErrors`, `error`, and `connection` (`connecting` / `open` /
  `retry-wait` / `closed`) for a target that owns a connection (OBS's websocket, the React client's
  SSE). A medium's `update()` promise is the only "revision settled" signal. Targets never know what
  React is.
- A **plugin** renders one source kind in one target (`ReactSourcePlugin`, `DomSourcePlugin`,
  `ObsSourcePlugin`), with a create / update / dispose lifetime. Built-ins are plugins too.
- **Transport** means only how bytes move (SSE, the OBS WebSocket `ObsTransport`). Do not use
  "compositor", "runtime message", or "transport" for the stream itself.

## Non-negotiable invariants

1. React host methods perform only synchronous local mutation.
2. Yoga owns common layout; DOM CSS does not independently lay out the scene.
3. Explicit IDs, never React keys, identify remote resources.
4. OBS resources outside the show's managed namespace are never modified.
5. Async target errors are observable target state, not delayed React exceptions.
6. Stable desired state and one-shot commands remain separate.

## Code conventions

- ESM, strict TypeScript, named exports, kebab-case filenames.
- Prefer closed discriminated unions and readonly public data. "Readonly" means types (`readonly`
  properties, `as const`), not runtime freezing. Reserve `Object.freeze`/`deepFreeze` for data
  crossing the user→authoring or core→target boundary: compiled snapshots, cloned authoring inputs,
  and frame definitions. Do not freeze internal or same-process trusted data.
- No string-indexed settings bags in core public APIs.
- Lifecycles with concurrent concerns (composer, target kernel, OBS connection and convergence) are
  XState v5 machines with async work in `fromPromise` / `fromCallback` actors. A lifecycle that is
  one loop with one phase variable (the SSE reconnect in `stream/sse.ts`) stays a loop.
- Errors at authoring boundaries become deterministic diagnostics where possible.
- Add or update behavior tests with implementation changes, but prioritize the correct abstraction
  over test-shaped production APIs.
