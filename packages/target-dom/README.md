# @strangecyan/vignette-target-dom

Browser target for compiled Vignette snapshots. It applies the compiler's absolute layout rather
than asking CSS to independently lay out a scene.

## Install

```sh
pnpm add @strangecyan/vignette-target-dom @strangecyan/vignette-core
```

## React compositor

```tsx
import { sseRuntimeSource, useCompositor } from "@strangecyan/vignette-target-dom/react";

export function Program() {
  const [ref, status] = useCompositor({
    sceneId: "main",
    transport: sseRuntimeSource("/runtime"),
    onError: console.error,
  });
  return <div ref={ref} data-phase={status.phase} />;
}
```

The hook owns the SSE subscription and `DOMRuntime`, supports server rendering, and disposes both
when its container detaches. Importing `./react` requires React.

Snapshots and manifests may carry root-relative URLs such as `/__vignette/frame/...` and
`/assets/...`. They resolve against the `baseUrl` option, which defaults to the transport URL
(`/runtime` above, relative to the page) and otherwise to `document.baseURI`. Absolute URLs are used
unchanged.

For non-React clients, construct `DOMRuntime` with a container, call `setup(manifest)` before
`update(snapshot)`, forward one-shot events with `event()`, and call `dispose()` at shutdown. Add
custom source renderers through `extensions`; built-in image, media, browser, and color renderers
are always available. Runtime status and `whenSettled()` expose local convergence without coupling
it to the composer.
