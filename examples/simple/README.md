# Simple example

The smallest complete Vignette composition: one reusable color source, one layer, and one scene. It
renders locally and prints the compiled, target-neutral snapshot without requiring a browser,
server, OBS, or third-party service.

```sh
corepack pnpm --filter @strangecyan/vignette-simple-example build
corepack pnpm --filter @strangecyan/vignette-simple-example start
```

Start with [`src/show.tsx`](src/show.tsx), which exports the composition definition — its project
ID, canvas, and top-level component — as `composition`. [`src/index.ts`](src/index.ts) is the host:
`createComposerRoot(composition)` followed by `root.render()`. Move to
[`../kitchen-sink`](../kitchen-sink) when you need a browser preview, frames, SSE, or OBS.
