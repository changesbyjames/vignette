# @cbj/vignette-server

Platform-neutral orchestration for a persistent Vignette composer. `ComposerHost` joins the React
root, runtime message replay hub, `/runtime` SSE endpoint, and typed frame routes behind the Web
Fetch API while leaving server and target process ownership to the application.

## Install

```sh
pnpm add jsr:@cbj/vignette-server jsr:@cbj/vignette-frame jsr:@cbj/vignette jsr:@cbj/vignette-core react
```

## Create a host

```tsx
import { projectId } from "@cbj/vignette-core";
import { createComposerHost } from "@cbj/vignette-server";

const host = createComposerHost({
  projectId: projectId("demo"),
  canvas: { width: 1920, height: 1080, frameRate: 60 },
  manifest: { version: 1, assets: [] },
  frameOrigin: "http://localhost:4173",
  scene: <Show />,
});

host.addEventListener("error", (event) => console.error(event.error));
await host.start();

export default { fetch: host.fetch };
```

For Node HTTP, pass the host to `createNodeRequestHandler` from `@cbj/vignette-server/node`.
`connect(runtime)` transfers runtime ownership to the host; `close()` disposes connected runtimes
and the composer. Supply a frame `ModuleHost` from `@cbj/vignette-frame/vite` in development,
`@cbj/vignette-frame/server` for an injected manifest, or `@cbj/vignette-frame/server/node` for a
filesystem-backed production manifest.

For a deployable host/worker split, the worker consumes the host's SSE URL with the DOM or OBS
target package. See the repository kitchen-sink example for Vite client and SSR builds.
