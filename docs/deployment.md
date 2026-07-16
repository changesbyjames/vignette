# Production deployment

The kitchen-sink production build creates a static client and two independent Node entries:

- `dist/server/host.js`: composer, `/runtime` SSE, frame SSR, hydration routes, and static client.
- `dist/server/obs-worker.js`: consumes `/runtime` and owns the OBS WebSocket connection.

```sh
pnpm build
pnpm --filter @cbj/vignette-kitchen-sink start:host
VIGNETTE_RUNTIME_URL=http://127.0.0.1:4173/runtime \
  pnpm --filter @cbj/vignette-kitchen-sink start:obs
```

Configure `PORT`, `HOST`, and `VIGNETTE_ORIGIN` on the host. Configure `VIGNETTE_RUNTIME_URL`,
`VIGNETTE_ASSET_ORIGIN`, `VIGNETTE_OBS_URL`, and `VIGNETTE_OBS_PASSWORD` on the worker. The worker
uses `@cbj/vignette-target-obs`'s `sseRuntimeSource`, which has the same `RuntimeMessageSource` API
as the DOM runtime's SSE source and reconnects to the host with setup/latest-snapshot replay.

`VIGNETTE_ORIGIN` is the public URL embedded in browser-source snapshots, so for local Docker it is
`http://127.0.0.1:4173`. `VIGNETTE_ASSET_ORIGIN` rewrites only the worker's manifest downloads to
the internal service URL (`http://vignette-host:4173`); it does not leak into UI or OBS URLs.

## Docker example

Run both services with Compose:

```sh
VIGNETTE_OBS_PASSWORD=runtime-only docker compose -f examples/kitchen-sink/compose.yaml up --build
```

Or build the images separately from the repository root:

```sh
docker build -f examples/kitchen-sink/Dockerfile.host -t vignette-host .
docker build -f examples/kitchen-sink/Dockerfile.obs -t vignette-worker .
```

The Compose example reaches host OBS through `host.docker.internal` and includes Linux's
`host-gateway` mapping. For remote deployments, set `VIGNETTE_ORIGIN` and `VIGNETTE_OBS_URL` to
their reachable HTTP(S) and WebSocket endpoints.
