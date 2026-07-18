# React DOM frames

`@strangecyan/vignette-frame` lowers typed React DOM content to ordinary browser sources. Core
snapshots remain unaware of schemas, React DOM, SSR, and hydration.

## Authoring

```tsx
import { createSceneStore, frame, SceneProvider, View } from "@strangecyan/vignette-frame";
import { z } from "zod";

export const greeting = frame({
  params: z.object({ name: z.string() }),
  view: ({ name }) => <div>Hello {name}!</div>,
});

const scene = createSceneStore({ origin: "https://example.com" });

<SceneProvider scene={scene}>
  <View source={greeting} params={{ name: "James" }} viewport={{ width: 1280, height: 720 }} />
</SceneProvider>;
```

`SceneProvider` subscribes with `useSyncExternalStore`; `scene.set({ origin })` reactively updates
frame URLs without another root `render()` call. Params are synchronously validated and must be
JSON-safe. They appear in the URL, so never include secrets or sensitive data.

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
