# Deployment

[README §4](../README.md#4-hosting-in-production) is the recipe: compile the show, run `bundle`,
`compose` with `assets` and `serve`, put `composer.stream()` on a wire, and serve the bundle
directory at the URLs you published. `examples/kitchen-sink/src/server/entry.ts` is that recipe on
Hono.

## Checklist

- `serve.stream`, `serve.assets` and `serve.frames` are **absolute URLs as OBS reaches them**. They
  are published in setup; no target derives a location. When the OBS machine reaches the host at
  another address, publish that address, or override per target with
  `obsTarget({ assets: { fetch }, frames })`.
- Serve `frames.html`, `frames.<hash>.js` and `assets/` from any static host or CDN. The bundle is
  named by its content hash, so serve it as immutable
  (`Cache-Control: public, max-age=31536000, immutable`) and `frames.html` with `no-cache`; a new
  bundle is a new file name, and only the small page is revalidated. `vignette build`'s `server.js`
  sends these headers.
- Pass `frames.json`'s `build` to `compose({ frameBuild })`. Each frame source then carries it, and
  its page URL ends in `v=<build>`, so after a deploy the targets reload just the frame pages: OBS
  gets a new browser source URL, and React and DOM iframes navigate. It is not in setup, so nothing
  else reconnects. A page that still runs old code (served from a cache) reloads itself once with
  `?reload=<build>`.
- Run `vignette obs <stream-url>` (or `obsTarget` in your process) on the machine with OBS, with
  `--source <module>` for every custom kind the show uses.
- One composer per show. Each SSE subscriber gets setup and the latest update replayed, so
  reconnects converge without coordination.

## Docker

The kitchen sink ships a host image and a `vignette obs` image:

```sh
docker compose -f examples/kitchen-sink/compose.yaml up --build
```

`PUBLIC_ORIGIN` on the host is what the stream publishes. The OBS container uses host networking so
that address and OBS's obs-websocket are both reachable on `127.0.0.1`.

## Cloudflare Workers and Durable Objects

The composer runs in a Durable Object: swap the HTTP server for the object's `fetch` handler, serve
`composer.stream()` as SSE from it, and put the bundle directory in R2 or static assets. Workers
cannot compile WebAssembly at runtime, so pass a compiled Yoga module:
`import wasm from "@strangecyan/vignette/yoga.wasm"` and
`compose(show, { layout: await loadYoga(wasm) })`. `@strangecyan/vignette/bundle` and
`@strangecyan/vignette/obs` need Node and do not run in Workers; run `bundle` at build time and
`vignette obs` next to OBS.
