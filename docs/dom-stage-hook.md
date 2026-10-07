# DOM stage React hook

`@strangecyan/vignette-target-dom` remains React-free. Its optional
`@strangecyan/vignette-target-dom/react` entry point provides `useStage`, which renders a composer
stream into a container (the **stage**) in a React application:

```tsx
import { sseStream, useStage } from "@strangecyan/vignette-target-dom/react";

export function Preview() {
  const [ref, stage] = useStage({
    sceneId: "main",
    stream: sseStream("/stream"),
  });

  return (
    <>
      <div ref={ref} />
      <output>{stage.phase}</output>
    </>
  );
}
```

The required `stream` delivers `setup`, `update`, and `event` messages. The hook creates a
`DOMRuntime` when the callback ref receives its container, aborts the stream and disposes the
runtime when the container detaches, and recreates both when a material option changes.

## Return value

The hook returns a readonly tuple:

```ts
readonly [
  ref: React.RefCallback<HTMLDivElement>,
  status: StageStatus,
]
```

The status is cached until a real store transition and contains:

- `phase`: container, connection, asset-download, target apply, error, or disposal state;
- `revision`: the latest settled target revision, or zero before settlement;
- `desiredRevision` and `settledRevision` when supplied by the target;
- `targetId`, `sceneId`, and an optional error/status message.

During server rendering the stable status is `waiting-for-container`. No EventSource, runtime, DOM
stage, or asset download is created until React attaches the client ref.

## Alternate streams

Pass another SSE URL:

```tsx
const [ref] = useStage({
  sceneId: "main",
  stream: sseStream("/broadcast/stream"),
});
```

Or provide an in-memory/remote adapter as an abort-aware factory:

```tsx
const [ref] = useStage({
  sceneId: "main",
  stream: (signal) => streamMessages(messageBus, signal),
});
```

Root-relative frame and asset URLs in snapshots resolve against `baseUrl`, which defaults to the
stream's `url` (set by `sseStream`) and otherwise to the document's `baseURI`. Pass `baseUrl`
explicitly when a custom stream reads from another host.

The hook forwards `id`, `baseUrl`, `fetch`, object-URL functions, and `onError` to `DOMRuntime`,
making tests and non-browser streams injectable without introducing global configuration.

## Direct external-store usage

`DOMRuntime` itself exposes bound, stable methods:

```tsx
const status = useSyncExternalStore(
  runtime.subscribe,
  runtime.getSnapshot,
  runtime.getServerSnapshot,
);
```

`getSnapshot()` delegates to the target's cached immutable `TargetStatus`; repeated calls return the
same object until the target changes. `getServerSnapshot()` retains the initial disconnected status.
The runtime deliberately does not own SSE or any other transport; consuming the stream belongs to
the hook or the calling application.
