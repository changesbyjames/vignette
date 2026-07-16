# @cbj/react-obs-target-dom

Browser target for compiled React OBS snapshots. It applies the compiler's absolute layout rather
than asking CSS to independently lay out a scene.

## Install

```sh
pnpm add jsr:@cbj/react-obs-target-dom jsr:@cbj/react-obs-core
```

## React compositor

```tsx
import { sseRuntimeSource, useCompositor } from "@cbj/react-obs-target-dom/react";

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

For non-React clients, construct `DOMRuntime` with a container, call `setup(manifest)` before
`update(snapshot)`, forward one-shot events with `event()`, and call `dispose()` at shutdown. Add
custom source renderers through `extensions`; built-in image, media, browser, and color renderers
are always available. Runtime status and `whenSettled()` expose local convergence without coupling
it to the composer.
