# Vignette

Vignette is a scene-authoring runtime for describing fixed-resolution live broadcast scenes once and
materializing them in both the browser and OBS.

React and Yoga run in a platform-owned composer. It emits one target-neutral immutable snapshot;
independent DOM and OBS runtimes consume setup, update, and event messages over SSE or an in-memory
`AsyncIterable`. The composer never waits for or observes runtime convergence.

## Published packages

The packages are published on [npm](https://www.npmjs.com/org/strangecyan). For a Node/Vite composer
with a browser preview:

```sh
pnpm add @strangecyan/vignette @strangecyan/vignette-core \
  @strangecyan/vignette-frame @strangecyan/vignette-vite \
  @strangecyan/vignette-target-dom react react-dom
```

Add `@strangecyan/vignette-target-obs` for OBS output, `@strangecyan/vignette-moq` for Media over
QUIC, or `@strangecyan/vignette-testkit` for target and planner tests. Install
`@strangecyan/vignette-preview` for the PNG preview CLI. Each package README documents its
entrypoints and extension seams. Start with the intentionally small
[`examples/simple`](examples/simple), then use [`examples/kitchen-sink`](examples/kitchen-sink) as a
Vite, frame, SSE, MoQ, and optional OBS application template.

Maintainers can find package ordering and tokenless GitHub OIDC release instructions in
[`docs/publishing.md`](docs/publishing.md).

## Repository layout

- `packages/core` — target-neutral graph, validation, layout, snapshots, and stream contracts.
- `packages/react` — Node-side custom React composer and typed authoring primitives.
- `packages/frame` — optional typed React DOM frames with Vite SSR and hydration.
- `packages/vite` — frame discovery, deterministic client entries, and build-derived assets.
- `packages/target-dom` — manifest asset cache, browser `DOMRuntime`, and optional React hook.
- `packages/target-obs` — manifest asset cache, `OBSRuntime`, planner, and convergence worker.
- `packages/moq` — optional Media over QUIC source extension for all three layers.
- `packages/testkit` — target and OBS fakes shared by package tests.
- `packages/preview` — Playwright CLI for exact-canvas snapshot PNGs with static placeholders.
- `examples/simple` — minimal local composition that prints one compiled snapshot.
- `examples/kitchen-sink` — Node composer, SSE, frames, DOM, public MoQ demo, and optional OBS
  example.
- `docs` — architecture decisions and supported compatibility contract.
- `reference` — pinned upstream documentation used to design and maintain the runtime.
- `plans` — staged implementation handoffs and completion state.

## Development

Requires Node 22 or newer and Corepack.

```sh
corepack enable
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
```

To capture the first scene from a running composer or a saved snapshot:

```sh
pnpm exec vignette preview --snapshot http://localhost:4173/runtime --name "test 01"
```

The first release intentionally supports a narrow common surface: image, local media, browser, and
color sources; fixed-canvas Yoga layout; absolute transforms; fit/crop; visibility; and rotation.
DOM additionally supports opacity, which OBS diagnoses and omits. See
[`docs/compatibility-contract.md`](docs/compatibility-contract.md) for the precise boundary.
