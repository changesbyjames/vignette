# Vendored Project References

This directory is a local, read-only documentation snapshot for the libraries
and protocols used by the planned React-to-DOM/OBS scene renderer. It exists so
implementers can work against the same source material even when upstream
documentation changes.

The files are reference material, not application source. Do not edit vendored
files to describe project decisions; put project decisions in `plans/` now and
in `docs/adr/` once implementation begins.

## What is included

- `react-reconciler/` — the exact published `react-reconciler@0.33.0` README
  and package metadata, plus the matching React 19.2 host-config export surface.
- `react-dom/` — the official `hydrateRoot` and `renderToString` references used
  by optional browser frames.
- `react/` — the official `useSyncExternalStore` reference used by the optional
  DOM compositor hook.
- `yoga/` — Yoga documentation for configuration, tree layout, incremental
  layout, external layout systems, and the supported style properties.
- `obs-websocket/` — the generated current 5.x protocol in Markdown and JSON.
- `obs-websocket-js/` — transport README, package metadata, and public type/API
  source for version 5.0.8.
- `typescript/` — selected official handbook and project-reference material.
- `vitest/` — selected official unit/workspace/mocking/snapshot guidance.
- `playwright/` — selected official browser, assertion, snapshot, configuration,
  and web-server testing guidance.
- `pnpm/` — official workspace, install, manifest, and workspace-file guidance.
- `vite/` — selected official development-server, asset, environment, and build
  guidance plus the Vite 8.1.4 plugin API used by the frame adapter.
- `zod/` — the exact Zod 4.4.3 README, package metadata, and license used by the
  typed frame example.
- `pixelmatch/` and `pngjs/` — the image decode and comparison APIs used by the
  parity harness.
- `moq-watch/` — the selected `@moq/watch@0.3.0` web-component API and package metadata.
- `obs-moqsource/` — the exact input ID and settings contract inspected from the custom local OBS
  plugin.

See `SOURCES.md` for exact upstream revisions, URLs, versions, licenses, and the
retrieval date.

## Intended use

Use these references in this order for architecture work:

1. `react-reconciler/README.md` and
   `react-reconciler/source/ReactFiberConfig.custom.js` for the renderer host
   contract.
2. `yoga/docs/` for layout behavior and deliberate Yoga configuration.
3. `obs-websocket/protocol.md` for remote resource identity, request fields,
   response fields, events, batch behavior, and error codes.
4. `obs-websocket-js/README.md` and `source/types.ts` for the TypeScript client
   surface.
5. The test/tooling directories when implementing the workspace, studio, and
   parity harness.

## Refresh policy

Do not refresh these files opportunistically during feature work. Refresh them
as a dedicated dependency task, update `SOURCES.md`, and review protocol or API
changes before changing dependency versions. In particular, React and
`react-reconciler` must be upgraded and verified as a pair.
