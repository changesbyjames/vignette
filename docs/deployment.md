# Production deployment

The kitchen-sink production build creates a static client and two independent Node entries:

- `dist/server/host.js`: Hono routing around the composer root, SSE, frame SSR, and static client.
- `dist/server/obs-worker.js`: consumes `/stream` and owns the OBS WebSocket connection.

```sh
pnpm build
pnpm --filter @strangecyan/vignette-kitchen-sink start:host
VIGNETTE_STREAM_URL=http://127.0.0.1:4173/stream \
  pnpm --filter @strangecyan/vignette-kitchen-sink start:obs
```

Configure `PORT` and `HOST` on the host. Configure `VIGNETTE_STREAM_URL`,
`VIGNETTE_BROWSER_SOURCE_BASE_URL` (optional), `VIGNETTE_OBS_URL`, and `VIGNETTE_OBS_PASSWORD` on
the worker. The worker uses `@strangecyan/vignette-target-obs`'s `sseStream`, which has the same
`StreamSource` API as the DOM runtime's SSE source and reconnects to the host with
setup/latest-snapshot replay.

The host never needs to know its public origin: snapshots and the asset manifest carry root-relative
URLs (`/__vignette/frame/...`, `/assets/...`) and each target resolves them. The worker passes
`VIGNETTE_STREAM_URL` as the OBS runtime's `baseUrl`, so manifest downloads use the host the worker
already reaches. OBS loads browser sources itself, so when OBS reaches the host at a different
address than the worker, set `VIGNETTE_BROWSER_SOURCE_BASE_URL` (the runtime's
`browserSourceBaseUrl`). In local Docker, the worker uses `http://vignette-host:4173` while OBS on
the Docker host uses the published `http://127.0.0.1:4173/`.

`@strangecyan/vignette-vite` emits frame entries under `assets/vignette/frame/` and the hydration
helper at `assets/vignette/frame-client.js`. These deterministic entry names are intentionally not
content-hashed and should be served with `Cache-Control: no-store`.

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
`host-gateway` mapping. For remote deployments, set `VIGNETTE_STREAM_URL`,
`VIGNETTE_BROWSER_SOURCE_BASE_URL` (when OBS sees the host differently), and `VIGNETTE_OBS_URL` to
their reachable HTTP(S) and WebSocket endpoints.
