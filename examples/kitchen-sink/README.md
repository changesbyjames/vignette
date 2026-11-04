# Kitchen-sink example

Every part of Vignette in one show, hosted the way
[README §4](../../README.md#4-hosting-in-production) describes. The only remote input is the public
`https://cdn.moq.dev/demo` / `bbb.hang` MoQ demo broadcast.

- [`src/show.tsx`](src/show.tsx) default-exports the `<Show>`: inline `Color` and `Image` sources,
  one shared `<Moq id="demo">` placed with `<Use>` in two scenes, `<Frame of={Clock}>` and
  `<Frame of={Label}>` with params, and a timer that highlights cards and drives `activeScene`
  between `main` and `focus` so scene switching is visible.
- [`src/clock.frame.tsx`](src/clock.frame.tsx), [`src/label.frame.tsx`](src/label.frame.tsx) are
  frames: React DOM components with a name and a params schema.
- [`src/server/entry.ts`](src/server/entry.ts) is the README's five steps on Hono: `compose` with
  the bundle's manifest and `serve` locations, `/stream` over SSE with `toSseEvent`, the bundle at
  `/vignette/`, the preview app at `/`, and optionally `obsTarget` in the same process.
- [`src/app.tsx`](src/app.tsx) is the browser preview:
  `<Stream url="/stream" sources={[MoqView]}><Stage /></Stream>` with a `useStreamStatus` readout.
- [`scripts/bundle.mjs`](scripts/bundle.mjs) calls `bundle()` from `@strangecyan/vignette/bundle`,
  writing `public/vignette/` (`frames.html`, `frames.js`, `assets/`, `assets.json`).

## Run it

```sh
pnpm build                                     # from the repository root
pnpm --filter @vignette/kitchen-sink start     # http://127.0.0.1:3000
```

`build` is `tsc` (server and show) + `scripts/bundle.mjs` + `vite build` (the app). `PORT`, `HOST`
and `PUBLIC_ORIGIN` configure the server; `PUBLIC_ORIGIN` is what the stream publishes in `serve`.

While the server runs, `pnpm --filter @vignette/kitchen-sink dev` serves the app with hot reload at
`http://127.0.0.1:4173`, proxying `/stream` and `/vignette` to port 3000. To preview the show alone
without this app, use `pnpm --filter @vignette/kitchen-sink dev:show` (`vignette dev`).

## OBS

Set `OBS_URL` (and `OBS_PASSWORD`) when starting the server to drive OBS from the same process, or
run `vignette obs` against the stream from the OBS machine:

```sh
pnpm --filter @vignette/kitchen-sink obs   # vignette obs http://127.0.0.1:3000/stream --source @strangecyan/vignette-moq/obs
```

OBS shows the MoQ source with its native `moq_source` input when the MoQ plugin is installed, and
otherwise as a media source playing RTMP from a local `moq` CLI relay, so install
[moq-cli](https://github.com/moq-dev/moq) next to `vignette obs` (the OBS container image does).
`compose.yaml` runs the server and a `vignette obs` container against an OBS on the Docker host.

## Tests

- `src/server/production.test.ts` (in `pnpm test`): builds, starts the server, reads setup and an
  update with `fromSse`, and fetches the bundle.
- `tests/dom.spec.ts` (`pnpm test:e2e`, after `pnpm build`): the preview renders, the clock frame
  renders as an iframe that keeps its page across params changes and scene switches, revisions
  advance, and the shared `<moq-watch>` element survives scene switches with and without
  `Element.moveBefore`.
- `tests/obs-integration.spec.ts` (`pnpm test:obs-integration`): `obsTarget` against the example
  server and a real OBS. Requires `VIGNETTE_ALLOW_INTEGRATION=1`, `VIGNETTE_OBS_URL`,
  `VIGNETTE_OBS_PASSWORD` and `VIGNETTE_OBS_TEST_COLLECTION` naming the disposable scene collection
  OBS must have open.
