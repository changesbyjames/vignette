# React DOM frames

`@strangecyan/vignette-frame` lowers typed React DOM content to ordinary browser sources. Core
snapshots remain unaware of schemas, React DOM, SSR, and hydration.

## Authoring

```tsx
import { frame, View } from "@strangecyan/vignette-frame";
import { z } from "zod";

export const greeting = frame({
  params: z.object({ name: z.string() }),
  view: ({ name }) => <div>Hello {name}!</div>,
});

export const banner = frame({ view: () => <div>On air</div> });

<View source={greeting} params={{ name: "James" }} style={{ width: 1280, height: 720 }} />;
<View source={banner} style={{ width: 800, height: 120 }} />;
```

Omit `params` for a frame without parameters; its `<View>` placements omit `params` too. The page
renders at the placement's laid-out size unless `viewport` is set (a frame source placed at several
different sizes needs an explicit `viewport` or separate `id`s).

Each frame renders beneath a root `<Suspense fallback={null}>` on the server and during hydration,
so views can use suspending hooks such as `useRemoteStore` without their own boundary.

`<View>` emits a root-relative browser-source URL (`/__vignette/frame/<routeKey>?props=...`), so the
composer never needs its public origin. Each target resolves the URL against its own base URL (see
[URL resolution](compatibility-contract.md#url-resolution)). Params are synchronously validated and
must be JSON-safe. They appear in the URL, so never include secrets or sensitive data.

## Build Integration

```ts
import { vignette } from "@strangecyan/vignette-vite";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [vignette()] });
```

The plugin transforms exported `frame()` definitions, statically imports every discovered
`src/**/*.frame.{tsx,jsx}` module into `virtual:vignette/frames`, and emits deterministic browser
entries. Hosts import `frames` and pass it to `createFrameRequestHandler(frames)`, or call
`renderFrameHtml` and `renderHydrationModule` from their own router. No dynamic module loading or
client manifest is required.

Frame modules must remain browser-safe. The same module is imported for server rendering and in the
iframe browser. Frame HTML and deterministic client entries should use `Cache-Control: no-store`.
