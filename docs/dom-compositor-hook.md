# DOM compositor React hook

`@cbj/react-obs-target-dom` remains React-free. Its optional `@cbj/react-obs-target-dom/react` entry
point provides a lifecycle wrapper for React applications:

```tsx
import { sseRuntimeSource, useCompositor } from "@cbj/react-obs-target-dom/react";

export function Preview() {
  const [ref, compositor] = useCompositor({
    sceneId: "main",
    transport: sseRuntimeSource("/runtime"),
  });

  return (
    <>
      <div ref={ref} />
      <output>{compositor.phase}</output>
    </>
  );
}
```

The required `transport` delivers `setup`, `update`, and `event` messages. The hook creates
`DOMRuntime` when the callback ref receives its container, aborts the transport and disposes the
runtime when the container detaches, and recreates both when a material option changes.

## Return value

The hook returns a readonly tuple:

```ts
readonly [
  ref: React.RefCallback<HTMLDivElement>,
  snapshot: CompositorSnapshot,
]
```

The snapshot is cached until a real store transition and contains:

- `phase`: container, connection, asset-download, target apply, error, or disposal state;
- `revision`: the latest settled target revision, or zero before settlement;
- `desiredRevision` and `settledRevision` when supplied by the target;
- `targetId`, `sceneId`, and an optional error/status message.

During server rendering the stable snapshot is `waiting-for-container`. No EventSource, runtime, DOM
stage, or asset download is created until React attaches the client ref.

## Alternate streams

Pass another SSE URL:

```tsx
const [ref] = useCompositor({
  sceneId: "main",
  transport: sseRuntimeSource("/broadcast/runtime"),
});
```

Or provide an in-memory/remote adapter as an abort-aware factory:

```tsx
const [ref] = useCompositor({
  sceneId: "main",
  transport: (signal) => runtimeMessages(messageBus, signal),
});
```

The hook forwards `id`, `fetch`, object-URL functions, and `onError` to `DOMRuntime`, making tests
and non-browser transports injectable without introducing global configuration.

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
The runtime deliberately does not own SSE or any other delivery transport; that composition belongs
to the hook or the calling application.
