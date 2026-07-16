# Plan 008: Deliver the vertical slice and parity harness

> **Executor instructions**: Integrate the completed packages without expanding
> v1 scope. Required CI tests must run without OBS; real-OBS tests are explicit,
> guarded integration tests against a disposable namespaced project. Update the
> plan index only after the default gates and documented manual OBS run pass.
>
> **Drift check (run first)**:
> `git diff --stat HEAD -- packages examples docs package.json playwright.config.ts`

## Status

- **Priority**: P1
- **Effort**: L (five to eight days)
- **Risk**: HIGH — first integration crosses browser, filesystem, WebSocket, and OBS
- **Depends on**: `plans/004-dom-target.md`, `plans/006-obs-async-convergence.md`, `plans/007-react-custom-renderer.md`
- **Category**: direction, tests, docs
- **Planned at**: `unborn main`, 2026-07-15

## Why this matters

The first vertical slice must prove the actual promise: one React scene produces
the same fixed-layout structure in a browser and a recoverable managed scene in
OBS. Structural unit tests alone cannot reveal crop, order, browser paint, asset
mapping, or reconnect mistakes. A guarded integration harness and static-image
parity fixture create an objective baseline without making a live OBS instance a
requirement for everyday development.

## Current state

- React can compile JSX into revisioned snapshots and publish to independent DOM
  and OBS targets.
- The default test suite uses only fake OBS.
- The selected additions are Vite 8.1.4, pixelmatch 7.2.0, pngjs 7.0.0, and
  `@types/pngjs` 6.0.5; local docs are under `reference/vite/`,
  `reference/pixelmatch/`, and `reference/pngjs/`.
- The example is a local trusted-machine development tool, not a remotely hosted
  control plane. OBS credentials must be entered at runtime and held only in
  memory.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Studio dev | `pnpm --filter @vignette/studio dev` | Vite listens on 127.0.0.1 |
| Browser E2E | `pnpm test:e2e` | Playwright passes without OBS |
| OBS integration | `VIGNETTE_ALLOW_INTEGRATION=1 pnpm test:obs-integration` | passes against disposable local OBS project |
| Full gates | `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e` | all exit 0 |

## Suggested executor toolkit

- Read `reference/vite/index.md`, `assets.md`, and `env-and-mode.md`.
- Read `reference/playwright/test-snapshots-js.md` and `test-webserver-js.md`.
- Read `GetSourceScreenshot` in `reference/obs-websocket/protocol.md`.
- Read the pixelmatch and pngjs READMEs before setting comparison thresholds.

## Scope

**In scope**:

- Root `package.json`, `playwright.config.ts`, and `.gitignore` additions
- `examples/studio/package.json`, Vite/TypeScript config, HTML, and `src/**`
- `examples/studio/public/assets/background.png` and deterministic static fixtures
- `examples/studio/tests/dom.spec.ts`
- `examples/studio/tests/obs-integration.spec.ts`
- `examples/studio/tests/parity.ts`
- `examples/studio/tests/fixtures.tsx`
- `examples/studio/README.md`
- `docs/getting-started.md`
- `docs/obs-safety.md`
- Public API clarifications strictly necessary to complete the slice

**Out of scope**:

- Production authentication service, remote hosting, Electron, automatic asset
  copying, native OBS plugin, text parity, audio, filters, transitions, capture,
  commands, animations, duplicate placements, multiple collections/canvases, or
  CI provisioning of OBS.

## Git workflow

- Branch: `codex/008-vertical-slice`.
- Suggested commit: `feat: deliver dom and obs vertical slice`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Build the local studio application

Create a Vite app bound to `127.0.0.1`. It renders a controls shell with ReactDOM
and creates one separate broadcast renderer root for the scene declaration. The
scene contains a 1920x1080 canvas, background image, looping muted media, browser
source, flex row, padding/gap, cover/contain fitting, and an absolute overlay.

Controls change padding, direction, visibility, and child order. Display root
commit revision and independent DOM/OBS status. Do not render control buttons
inside the custom broadcast root.

**Verify**: `pnpm --filter @vignette/studio dev` -> page loads locally, DOM
target settles, and controls change its revision and geometry.

### Step 2: Implement explicit per-target asset resolution

DOM assets resolve to same-origin Vite URLs. OBS assets resolve under a user-entered
absolute asset root on the same machine; normalize and verify the resolved path
stays under that root. Browser URLs remain URLs. Add preflight output for missing
asset root, missing asset, unsupported input kind, and unavailable request.

Do not put an OBS password or filesystem root in Vite environment variables,
localStorage, query strings, logs, or generated bundles. Accept them through a
runtime connection form and retain them only in memory.

**Verify**: unit/E2E tests inspect storage and page content to ensure a supplied
sentinel password is never persisted or rendered after connection.

### Step 3: Add deterministic DOM end-to-end tests

Configure Playwright's web server to start the studio. Test fixed stage size,
compiled data attributes, source element types, flex-control changes, reorder,
remove, and target status. Add a static color+image parity route at exact
1920x1080 with animation, video, iframe, transitions, caret, and clocks disabled.

Commit a reviewed DOM golden screenshot for only this deterministic route.

**Verify**: `pnpm test:e2e` -> passes twice consecutively with no screenshot diff.

### Step 4: Add a guarded real-OBS integration suite

The suite must skip unless `VIGNETTE_ALLOW_INTEGRATION=1`. Require URL, password,
and asset-root environment variables at process runtime. Use a unique project ID
under a clearly test-only namespace. Before mutation, assert the current
collection name matches an explicit expected test collection variable; otherwise
abort without requests.

Test initial bootstrap, create, transform, reorder, remove, final-reference
garbage collection, disconnect/reconnect, existing managed recovery, and
unmanaged coexistence. Cleanup only the unique project's managed names. Never
switch or delete a scene collection.

**Verify**: integration run passes against a disposable OBS profile/collection,
then `GetSceneList`/`GetInputList` confirm no test namespace remains.

### Step 5: Compare deterministic DOM and OBS screenshots

After the static parity scene settles, capture the DOM stage at 1920x1080 and
call `GetSourceScreenshot` for the managed OBS scene as PNG. Decode with pngjs,
require equal dimensions, compare with pixelmatch using a documented threshold,
and save DOM, OBS, and diff images under ignored `test-results/parity/`.

Report differing pixel count and ratio. Begin with a conservative threshold,
record the actual local baseline, and do not hide systematic translation,
cropping, z-order, or color errors by raising it. Keep video/browser sources out
of this deterministic assertion.

**Verify**: guarded OBS integration reports a diff ratio below the documented
limit and produces all three diagnostic images.

### Step 6: Exercise latest-wins behavior through the application

Trigger at least 100 rapid padding/order/visibility updates while OBS execution
is artificially delayed through a test transport wrapper. Assert the DOM and OBS
targets settle at the final revision, the pending snapshot count remains one,
and no stale removal executes. Repeat with a disconnect halfway through.

**Verify**: fake transport integration test passes deterministically without real OBS.

### Step 7: Document safe setup and the supported surface

Write getting-started instructions for install, local studio, OBS WebSocket
authentication, disposable integration collection, asset-root mapping, and the
example JSX. Document v1 supported sources/layout and explicit exclusions.

`docs/obs-safety.md` must explain exclusive managed naming, registry scene,
manual edit overwrite behavior, unmanaged-resource guarantees, integration-test
guard, reconnection, and why credentials must not be embedded in browser builds.

**Verify**: follow the getting-started instructions from a clean clone through
the DOM E2E command; every referenced command and path exists.

### Step 8: Run final acceptance

Run default gates, browser E2E twice, and one guarded real-OBS integration run.
Capture versions and parity ratio in the Plan 008 completion note in
`plans/README.md` without recording credentials, host paths, or private URLs.

**Verify**: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e && pnpm test:e2e` -> all exit 0; guarded OBS integration separately exits 0.

## Test plan

Required CI tests cover DOM structure/visual output, controls, source lifecycle,
rapid revisions, disconnect repair with fake transport, and secret non-persistence.
Guarded real-OBS tests cover protocol capability discovery, bootstrap, CRUD,
ordering, transforms, recovery, ownership, cleanup, and static screenshot parity.

## Done criteria

- [x] One React scene declaration feeds both DOM and OBS targets.
- [x] Padding/direction/reorder/remove changes converge in both targets.
- [x] Disconnect/reconnect recovers managed identity and latest desired revision.
- [x] Static DOM and OBS screenshots meet the documented diff threshold.
- [x] Default tests need no OBS instance; real tests require an explicit guard.
- [x] Integration cleanup leaves unmanaged resources untouched and no test namespace.
- [x] Credentials are not persisted, logged, rendered, or bundled.
- [x] Getting-started and OBS safety docs are reproducible.
- [x] All default verification commands pass.
- [x] `plans/README.md` marks Plan 008 `DONE` with version/parity notes.

## STOP conditions

- The operator cannot provide a disposable OBS profile/scene collection for the
  guarded integration run.
- Screenshot parity fails for a systematic transform/order/crop reason; fix the
  responsible compiler/target plan rather than raising the threshold.
- Browser security restrictions require embedding or persisting the OBS password.
- Asset resolution would allow traversal outside the configured root.
- Cleanup cannot prove a resource belongs to the unique test project.

## Maintenance notes

Keep the static parity fixture deliberately boring; it is a geometry oracle, not
a showcase. Add dynamic media/browser tests as behavioral assertions with loose
timing, never to the pixel-perfect fixture. A production remote controller should
introduce a trusted local service rather than extending this browser credential model.
