# @strangecyan/vignette-core

Target-neutral contracts and compiler for Vignette. This package defines the authoring graph, stable
ID validation, source modules, Yoga layout, immutable compiled snapshots, assets, diagnostics, and
stream message protocol. It does not import React or a target implementation.

## Install

```sh
pnpm add @strangecyan/vignette-core
```

## Compile without React

```ts
import { compileBroadcast } from "@strangecyan/vignette-core";
import { broadcast, colorSource, layer, scene, sources } from "@strangecyan/vignette-core/builders";
import { yogaLayoutEngine } from "@strangecyan/vignette-core/layout-yoga";

const result = compileBroadcast(
  broadcast({
    projectId: "demo",
    canvas: { width: 1920, height: 1080, frameRate: 60 },
    children: [
      sources(colorSource({ id: "background", color: "#101820" })),
      scene({
        id: "main",
        children: [layer({ id: "background", sourceId: "background" })],
      }),
    ],
  }),
  { revision: 1, layoutEngine: yogaLayoutEngine },
);
```

`compileBroadcast` accepts any synchronous `LayoutEngine`. The `./layout-yoga` entrypoint exports
the default binding plus `createYogaLayoutEngine(yoga)` for a Yoga instance initialized by the host.

### Cloudflare Workers

yoga-layout compiles its embedded WebAssembly at runtime, which Workers forbid. Under the `workerd`
export condition (used by Wrangler and `@cloudflare/vite-plugin`), `./layout-yoga` instead
instantiates the same Yoga build from a precompiled `.wasm` module, so `yogaLayoutEngine` and
`createComposerRoot`'s default layout engine work in a Worker without aliases or patches. Other
hosts that require precompiled Wasm can build the engine explicitly:

```ts
import { createYogaWasmLayoutEngine } from "@strangecyan/vignette-core/layout-yoga-wasm";
import yogaWasm from "@strangecyan/vignette-core/yoga.wasm";

const layoutEngine = await createYogaWasmLayoutEngine(yogaWasm);
```

`./yoga.wasm` is the vendored binary from the pinned yoga-layout version, so layout is identical on
every host. Maintainers regenerate it with `pnpm --filter @strangecyan/vignette-core vendor:yoga`
after changing that version. Stream-only consumers (target runtimes) can import `./stream` and
`./sse` without loading the layout compiler.

Use `asset()` and an `AssetManifest` for resources that targets must resolve. Use `StreamHub`,
`consumeStream`, and the SSE codecs to connect a composer's stream to one or more independent target
runtimes. The `setup` message carries the project ID, the asset manifest, and the extension source
kinds the composer registered; targets refuse a setup they cannot satisfy
(`describeMissingExtensions` formats the shared actionable message). Extension packages define their
own source type and contribute a generic `SourceModule`, optionally naming the target entrypoints
that implement it in `entrypoints`; pass those modules to the compiler or composer rather than using
an open settings bag.

Source modules may implement `applyDefaults` for values that depend on the canvas or layout: color
sources default `size` to the canvas, and browser sources default `viewport` to the frame size of
the layers placing them (a diagnostic asks for an explicit viewport when those sizes differ).
Compiled snapshots always carry the resolved values.

The `./builders` entrypoint is optional. React projects normally author the same graph with
`@strangecyan/vignette`, which also re-exports the core types composition authors need; import core
directly when implementing targets, extensions, or stream plumbing.
