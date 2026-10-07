# `@strangecyan/vignette-vite`

Vite 8 integration for statically discovered Vignette frames, content-versioned composition assets,
and an optional dev-server composer.

```ts
import { vignette } from "@strangecyan/vignette-vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vignette({ assets: "public/**/*", composition: "./src/show.tsx" })],
});
```

Add `@strangecyan/vignette-vite/virtual` to `compilerOptions.types`, then import `frames` from
`virtual:vignette/frames` and `assets` from `virtual:vignette/assets`. Manifest asset URLs are
root-relative; pass the manifest to `createComposerRoot(composition, { assets })` unchanged and each
target resolves them against its own base URL. Frame client entries use deterministic URLs and must
be served with `Cache-Control: no-store`.

## Dev composer

With `composition` set, `vite dev` loads that module's `composition` export (from
`defineComposition`) in the SSR environment, renders it with `createComposerRoot`, and streams setup
and update messages over SSE at `runtimePath` (default `/runtime`), ready for
`sseRuntimeSource("/runtime")` or `vignette obs --url http://localhost:5173/runtime`. Production
builds are unaffected; host the composer yourself there.

- Editing the composition module or anything it imports re-renders the same root.
- Changing the composition's `id`, `canvas`, or `extensions`, or adding or removing a discovered
  asset, replaces the root and closes open streams; clients reconnect and receive the new setup.
- If the module fails to load, the last good root keeps streaming and the error is logged; the next
  edit retries.

`onComposerRoot(root, { composition, server, signal })` attaches extra consumers to each root, for
example an embedded OBS runtime fed by `consumeRuntimeMessages(runtime, root.messages(signal))`. It
is called again for every replacement root, and `signal` aborts when that root is retired or the
server closes; return a promise that settles once the consumer has released its resources.

## Configuration defaults

The plugin adds these to your configuration; Vite concatenates them with your own arrays, so nothing
you set is replaced:

- `optimizeDeps.exclude: ["yoga-layout"]` — Yoga initializes with top-level await.
- `resolve.dedupe: ["react", "react-dom"]` — frames and the reconciler need one React instance.
- During `vite dev`, `ssr.external: ["@strangecyan/vignette", "@strangecyan/vignette-frame"]` — the
  plugin renders frames and composes through Node-loaded copies of these packages, so SSR-evaluated
  application code must share them even when they are linked workspace packages.
