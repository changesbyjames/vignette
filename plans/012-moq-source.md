# Plan 012 — Add a portable MoQ source

Status: DONE

## Objective

Add one target-neutral MoQ source to compiled snapshots. Render it with `@moq/watch` in the DOM and
with the custom `moq_source` input from `/Users/jameswilliams/Developer/experiments/obs-moqsource`
in OBS. Exercise the public `https://cdn.moq.dev/demo` / `bbb.hang` broadcast in Studio and guarded
integration tests.

## Contract

`MoqSource` owns stable desired state only:

1. `url` — absolute HTTP(S) relay URL.
2. `broadcast` — non-empty Hang broadcast name.
3. `size` — target-neutral intrinsic video dimensions used by Yoga and placement transforms.
4. `latencyMs` — optional integer from 0 through 30000; defaults to 100 in both targets.
5. `video` and `audio` — optional enabled flags, both defaulting to true.
6. `quality` — `auto` or a rendition name, defaulting to `auto`.
7. `disableWhenHidden` — optional lifecycle policy, defaulting to true.

Snapshots do not contain a DOM element, OBS input kind, plugin path, or transport handle.

## Target mapping

| Neutral field | DOM `@moq/watch` | OBS `moq_source` |
|---|---|---|
| `url` | `url` attribute | `url` setting |
| `broadcast` | `name` attribute | `broadcast` setting |
| `latencyMs` | `latency` attribute | `latency_ms` setting |
| `video=false` | `visible="never"` | `video=false` |
| `audio=false` | `muted` attribute | `audio=false` |
| `quality` | video target rendition name | `quality` setting |
| `disableWhenHidden` | viewport visibility policy and registry retention | `disable_when_hidden` setting |

The browser element can mute audio but cannot currently prevent the audio track from downloading;
the user-visible output is equivalent, while OBS can disable subscription entirely.

## Implementation steps

1. Add `source:moq`, `MoqSource`, its builder, capability, validation, intrinsic sizing, immutable
   snapshot cloning, and public exports in core.
2. Add `<MoqSource />` to the React host vocabulary and lower it synchronously into the neutral
   authoring graph.
3. Add `@moq/watch@0.3.0` to the DOM target. Register its web component lazily during asynchronous
   target preparation so importing the package remains safe outside a browser.
4. Materialize a stable `<moq-watch><canvas /></moq-watch>` source element, update its attributes and
   rendition target in place, and reuse or dispose it according to `disableWhenHidden`.
5. Add a pure OBS codec for input kind `moq_source`; keep plugin discovery in capability data and
   transport/execution out of the codec.
6. Teach common DOM and OBS placement code that the MoQ source's intrinsic size is `size`.
7. Replace Studio's file-video panel with `https://cdn.moq.dev/demo` / `bbb.hang` and assert the DOM
   element configuration in Playwright.
8. Add core, React, DOM-codec, OBS-codec, and guarded live-OBS tests. The live test must confirm the
   exact input settings and poll until OBS returns a nonblank 1280×720 source screenshot.
9. Vendor the selected `@moq/watch` API material and the custom plugin contract under `reference/`.
10. Run install, build, typecheck, unit tests, lint, and format check, followed by browser and guarded
    OBS integration suites.

## Acceptance criteria

- One compiled snapshot is consumed unchanged by both runtimes.
- DOM updates do not recreate a stable MoQ element.
- OBS planning fails observably when `moq_source` is not installed.
- Studio shows the public Big Buck Bunny MoQ broadcast in DOM and OBS.
- The full repository verification suite passes.

## Stop conditions

- Stop if the installed OBS input kind is not exactly `moq_source`; do not guess a compatibility ID.
- Stop if a common option cannot be expressed without target-specific data in core; document the
  semantic difference instead of adding settings bags.
- Never install, rebuild, or modify the custom OBS plugin repository as part of this plan.

## Acceptance result (2026-07-16)

The dependency install and all six repository gates pass. Vitest reports 51 passing tests across 22
files; the DOM Playwright suite reports 4 passing tests. The guarded OBS suite reports 3 passing
tests: the MoQ case created `moq_source`, verified every mapped setting, and received a nonblank
1280×720 screenshot from `bbb.hang`; the React frame parity case remains at 6 differing pixels
(`0.0034%`). Reference checksums also pass in full.
