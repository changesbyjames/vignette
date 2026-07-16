# Plan 010: Add optional hydrated React DOM frames

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH — spans custom reconciliation, module transforms, SSR, hydration, and two browsers
- **Depends on**: `plans/009-node-composer-runtime-streams.md`
- **Planned at**: `unborn main`, 2026-07-15

## Architecture decision

React DOM frames are an optional authoring/server subsystem. They compile to the existing neutral
browser-source representation; core snapshots and DOM/OBS runtimes do not import the frame package
or receive executable component data.

## Steps

### 1. Add a generic embedded browser-view primitive

- Add `BrowserView` to the custom renderer as a combined browser source and layer declaration.
- Lower it to existing `source:browser` and `layer` nodes before validation and Yoga compilation.
- Preserve explicit/derived source and layer IDs in the resulting snapshot.

### 2. Define the typed optional frame API

- Add `frame({ params, view })`, `FrameProvider`, and `<View source params>` in a separate package.
- Infer component and View parameter types from any synchronous parse schema, including Zod.
- Validate, canonicalize, and URL-encode JSON-safe parameters during Node composition.
- Derive stable identity from module/export metadata and params, with an explicit `id` override.

### 3. Add server rendering and hydration

- Transform exported frame definitions with stable client module metadata.
- Serve frame HTML with `renderToString()` and escaped serialized props.
- Serve an external hydration module that imports the same frame export and calls `hydrateRoot()`.
- Revalidate params at the server and client boundaries.

### 4. Integrate the Node composer example

- Load the scene module through Vite's SSR pipeline so frame transforms apply in Node.
- Add the Vite frame plugin before the composer plugin.
- Replace the static browser fixture with a Zod-typed, hook-driven greeting frame.
- Preserve the user's existing reverse-row layout and the Big Buck Bunny media source.

### 5. Test boundaries and persistence

- Unit-test browser-view lowering, frame URL generation, canonical params, and Vite metadata.
- Fetch the frame URL and assert server-rendered content.
- Verify hydration and shared transparent browser CSS in Playwright.
- Advance multiple composer revisions and assert the iframe navigation identity does not change.

### 6. Document and verify

- Document module safety, runtime-local state, URL-visible params, origin reachability, and the
  current Vite development-server scope.
- Run all six repository gates, the studio build, and Playwright.

## Acceptance criteria

- [x] The requested `frame({ params, view })` and `<View source params>` composition works.
- [x] Zod infers params for both the view function and View call site.
- [x] HTML is rendered on the Node server and hydrated by the original exported React component.
- [x] DOM and OBS receive an ordinary browser-source URL with no executable snapshot payload.
- [x] Frame React state survives unrelated scene snapshot revisions in the DOM runtime.
- [x] The feature remains an optional package and plugin.
- [x] All verification gates pass after documentation and reference updates.

## Verification result

Completed on 2026-07-15 with all six repository gates, 39 unit tests across 19 files, the studio
Vite production build, and all three browser Playwright tests passing. The browser suite verifies
server-rendered frame HTML, invalid-param rejection, client hydration, transparent browser CSS, and
unchanged iframe navigation identity across multiple composer revisions.
