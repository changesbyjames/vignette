# @cbj/vignette-server

Node orchestration for a persistent Vignette composer. `ComposerHost` joins the React root, runtime
message replay hub, `/runtime` SSE endpoint, and typed frame routes while leaving HTTP server and
target process ownership to the application.

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
server.on("request", (request, response) => {
  void host.handleRequest(request, response).then((handled) => {
    if (!handled) response.writeHead(404).end();
  });
});
await host.start();
```

Attach the HTTP server before `start()`. `connect(runtime)` transfers runtime ownership to the host;
`close()` disposes connected runtimes and the composer. Supply a frame `ModuleHost` from
`@cbj/vignette-frame/vite` in development or `@cbj/vignette-frame/server` in production.

For a deployable host/worker split, the worker consumes the host's SSE URL with the DOM or OBS
target package. See the repository Studio example for Vite client and SSR builds.
