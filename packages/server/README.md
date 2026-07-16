# @cbj/react-obs-server

Node orchestration for a persistent React OBS composer. `ComposerHost` joins the React root, runtime
message replay hub, `/runtime` SSE endpoint, and typed frame routes while leaving HTTP server and
target process ownership to the application.

## Install

```sh
pnpm add jsr:@cbj/react-obs-server jsr:@cbj/react-obs-frame jsr:@cbj/react-obs jsr:@cbj/react-obs-core react
```

## Create a host

```tsx
import { projectId } from "@cbj/react-obs-core";
import { createComposerHost } from "@cbj/react-obs-server";

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
`@cbj/react-obs-frame/vite` in development or `@cbj/react-obs-frame/server` in production.

For a deployable host/worker split, the worker consumes the host's SSE URL with the DOM or OBS
target package. See the repository Studio example for Vite client and SSR builds.
