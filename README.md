# Vignette

Vignette is a scene-authoring runtime for describing fixed-resolution live broadcast scenes once and
materializing them in both the browser and OBS.

React and Yoga run in a Node composer. It emits one target-neutral, complete immutable snapshot;
independent DOM and OBS runtimes consume setup, update, and event messages over SSE or an in-memory
`AsyncIterable`. The composer never waits for or observes runtime convergence.

## Published packages

The packages are published as TypeScript source on [JSR](https://jsr.io/@cbj). For a Node/Vite
composer with a browser preview:

```sh
pnpm add jsr:@cbj/vignette jsr:@cbj/vignette-core \
  jsr:@cbj/vignette-server jsr:@cbj/vignette-frame \
  jsr:@cbj/vignette-target-dom react react-dom
```

Add `jsr:@cbj/vignette-target-obs` for OBS output, `jsr:@cbj/vignette-moq` for Media over QUIC, or
`jsr:@cbj/vignette-testkit` for target and planner tests. Each package README documents its
entrypoints and extension seams. Start with the intentionally small
[`examples/simple`](examples/simple), then use [`examples/kitchen-sink`](examples/kitchen-sink) as a
Vite, frame, SSE, MoQ, and optional OBS application template.

Maintainers can find package ordering and tokenless GitHub OIDC release instructions in
[`docs/publishing.md`](docs/publishing.md).

## Repository layout

- `packages/core` — target-neutral graph, validation, layout, snapshots, and stream contracts.
- `packages/react` — Node-side custom React composer and typed authoring primitives.
- `packages/frame` — optional typed React DOM frames with Vite SSR and hydration.
- `packages/target-dom` — manifest asset cache, browser `DOMRuntime`, and optional React hook.
- `packages/target-obs` — manifest asset cache, `OBSRuntime`, planner, and convergence worker.
- `packages/moq` — optional Media over QUIC source extension for all three layers.
- `packages/testkit` — target and OBS fakes shared by package tests.
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

The first release intentionally supports a narrow common surface: image, local media, browser, and
color sources; fixed-canvas Yoga layout; absolute transforms; fit/crop; visibility; and rotation.
DOM additionally supports opacity, which OBS diagnoses and omits. See
[`docs/compatibility-contract.md`](docs/compatibility-contract.md) for the precise boundary.
