# Getting started

Working in this repository. For using Vignette, start with [`README.md`](../README.md). A project
that uses it installs:

```sh
pnpm add vignette react react-dom @tanstack/react-query
pnpm add -D vite                  # vignette dev, build and bundle
pnpm add -D playwright            # vignette preview only
```

A host that only composes and drives OBS needs `vignette` and `react` alone.

```sh
pnpm install
pnpm build
pnpm test
```

## Examples

- `examples/simple`: the smallest show. `pnpm --filter @vignette/simple-example start` prints the
  snapshot from `compose(show).once()` with no server, browser or OBS.
- `examples/kitchen-sink`: everything else, hosted as in README §4. See its
  [README](../examples/kitchen-sink/README.md).

```sh
pnpm --filter @vignette/kitchen-sink start   # after pnpm build; http://127.0.0.1:3000
```

## Checks

`AGENTS.md` lists the six gates (`build`, `typecheck`, `test`, `lint`, `format:check`, plus
`publish:check`). `pnpm ready` runs them all, then the Playwright suite (`pnpm test:e2e`, which
needs `pnpm exec playwright install chromium` once).

The OBS suite needs a disposable OBS scene collection:

```sh
VIGNETTE_ALLOW_INTEGRATION=1 \
VIGNETTE_OBS_URL=ws://127.0.0.1:4455 \
VIGNETTE_OBS_PASSWORD='runtime-only' \
VIGNETTE_OBS_TEST_COLLECTION='Vignette Tests' \
pnpm test:obs-integration
```

See [`obs-safety.md`](obs-safety.md) for what it may touch.
