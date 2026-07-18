# @strangecyan/vignette-cli

Command-line helpers for running and inspecting Vignette projects.

Install the npm CLI package in a Vignette project:

```sh
pnpm add -D @strangecyan/vignette-cli
pnpm exec playwright install chromium
```

## Stream to OBS

Stream a project's runtime SSE endpoint to OBS with the built-in source codecs and the official MoQ
codec:

```sh
pnpm exec vignette obs \
  --project demo \
  --obs-url ws://localhost:4455 \
  --password secret \
  --url https://localhost:5173/api/runtime
```

`--password` is optional for OBS instances without WebSocket authentication. The command runs until
it receives `SIGINT` or `SIGTERM`. It intentionally provides only the standard happy-path runtime:
there is no health endpoint or readiness checking.

## Capture a PNG

```sh
pnpm exec vignette preview \
  --snapshot http://localhost:4173/runtime \
  --scene programme \
  --name "test 01"
```

`--snapshot` accepts a JSON file, a JSON URL, or a Vignette runtime SSE URL. JSON may contain the
snapshot directly or an object with `{ "snapshot": ..., "manifest": ... }`. The first scene is used
unless `--scene <id|label>` or `--all-scenes` is supplied.

By default PNGs are written under `vignette-preview/`. Use `--out <file>` for one scene or
`--out <directory> --all-scenes` for multiple scenes. `--json` prints result metadata for agents and
scripts.
