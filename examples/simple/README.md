# Simple example

The smallest complete Vignette composition: one reusable color source, one layer, and one scene. It
renders locally and prints the compiled, target-neutral snapshot without requiring a browser,
server, OBS, or third-party service.

```sh
corepack pnpm --filter @cbj/vignette-simple-example build
corepack pnpm --filter @cbj/vignette-simple-example start
```

Start with [`src/index.tsx`](src/index.tsx). Move to [`../kitchen-sink`](../kitchen-sink) when you
need a browser preview, frames, SSE, or OBS.
