# Simple example

The smallest complete Vignette show: one scene with one layer holding a color. It renders locally
and prints the compiled snapshot without a browser, server, OBS, or third-party service.

```sh
pnpm --filter @vignette/simple-example build
pnpm --filter @vignette/simple-example start
```

[`src/show.tsx`](src/show.tsx) default-exports the `<Show>`. [`src/index.ts`](src/index.ts) is the
host: `compose(show).once()` renders the show, waits for it to settle, disposes the composer and
resolves to the snapshot. Long-running hosts keep the composer and read `composer.stream()` instead.
Move to [`../kitchen-sink`](../kitchen-sink) for a browser preview, frames, or OBS.
