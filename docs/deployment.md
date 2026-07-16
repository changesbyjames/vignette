# Production deployment

The studio production build creates a static client and two independent Node entries:

- `dist/server/host.js`: composer, `/runtime` SSE, frame SSR, hydration routes, and static client.
- `dist/server/obs-worker.js`: consumes `/runtime` and owns the OBS WebSocket connection.

```sh
pnpm build
pnpm --filter @cbj/react-obs-studio start:host
REACT_OBS_RUNTIME_URL=http://127.0.0.1:4173/runtime \
  pnpm --filter @cbj/react-obs-studio start:obs
```

Configure `PORT`, `HOST`, and `REACT_OBS_ORIGIN` on the host. Configure `REACT_OBS_RUNTIME_URL`,
`REACT_OBS_ASSET_ORIGIN`, `REACT_OBS_URL`, and `REACT_OBS_PASSWORD` on the worker. The worker uses
`@cbj/react-obs-target-obs`'s `sseRuntimeSource`, which has the same `RuntimeMessageSource` API as
the DOM runtime's SSE source and reconnects to the host with setup/latest-snapshot replay.

`REACT_OBS_ORIGIN` is the public URL embedded in browser-source snapshots, so for local Docker it is
`http://127.0.0.1:4173`. `REACT_OBS_ASSET_ORIGIN` rewrites only the worker's manifest downloads to
the internal service URL (`http://react-obs-host:4173`); it does not leak into UI or OBS URLs.

## Docker example

Run both services with Compose:

```sh
REACT_OBS_PASSWORD=runtime-only docker compose -f examples/studio/compose.yaml up --build
```

Or build the images separately from the repository root:

```sh
docker build -f examples/studio/Dockerfile.host -t react-obs-host .
docker build -f examples/studio/Dockerfile.obs -t react-obs-worker .
```

The Compose example reaches host OBS through `host.docker.internal` and includes Linux's
`host-gateway` mapping. For remote deployments, set `REACT_OBS_ORIGIN` and `REACT_OBS_URL` to their
reachable HTTP(S) and WebSocket endpoints.
