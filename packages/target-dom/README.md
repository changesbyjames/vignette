# @strangecyan/vignette-target-dom

Browser target for compiled Vignette snapshots. It applies the compiler's absolute layout rather
than asking CSS to independently lay out a scene.

## Install

```sh
pnpm add @strangecyan/vignette-target-dom @strangecyan/vignette-core
```

## React stage

```tsx
import { sseStream, useStage } from "@strangecyan/vignette-target-dom/react";

export function Program() {
  const [ref, status] = useStage({
    sceneId: "main",
    stream: sseStream("/stream"),
    onError: console.error,
  });
  return <div ref={ref} data-phase={status.phase} />;
}
```

`useStage` renders a composer stream into the returned container ref (the stage). The hook owns the
SSE subscription and `DOMRuntime`, supports server rendering, and disposes both when its container
detaches. Importing `./react` requires React.

Snapshots and manifests may carry root-relative URLs such as `/__vignette/frame/...` and
`/assets/...`. They resolve against the `baseUrl` option, which defaults to the stream URL
(`/stream` above, relative to the page) and otherwise to `document.baseURI`. Absolute URLs are used
unchanged.

For non-React clients, construct `DOMRuntime` with a container, call `setup(setup)` (project ID,
manifest, and advertised extension kinds, as carried by the `setup` message) before
`update(snapshot)`, forward one-shot events with `event()`, and call `dispose()` at shutdown. Add
custom source renderers through `extensions`; built-in image, media, browser, and color renderers
are always available. A setup advertising an extension kind without a registered renderer puts the
runtime in the `error` phase with an actionable message (for example "Stream requires source kind
'source:moq'; register @strangecyan/vignette-moq/dom.") and ignores updates until a satisfiable
setup arrives. The DOM target has no managed namespace, so it does not check the project ID. Runtime
status and `whenSettled()` expose local convergence without coupling it to the composer.
