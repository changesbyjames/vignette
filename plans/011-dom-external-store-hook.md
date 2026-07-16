# Plan 011: Make DOMRuntime an external store and add useCompositor

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MEDIUM — callback-ref and stream lifetimes must remain correct under Strict Mode
- **Depends on**: `plans/009-node-composer-runtime-streams.md`
- **Planned at**: `unborn main`, 2026-07-15

## Decisions

- Keep the base DOM target package entry React-free.
- Make `DOMRuntime` directly compatible with `useSyncExternalStore` through bound stable methods.
- Put the hook and browser SSE adapter under the optional `@vignette/target-dom/react` subpath.
- Return `[ref, snapshot]`; mounting the ref owns runtime creation and detaching owns cancellation
  and disposal.
- Preserve transport independence with a custom abort-aware `AsyncIterable` factory option.

## Steps

### 1. Add the external-store contract

- Expose `subscribe`, `getSnapshot`, and `getServerSnapshot` on `DOMRuntime`.
- Delegate live snapshots to the existing immutable target status store.
- Keep method references bound so callers can pass them directly to React.

### 2. Implement the optional React adapter

- Add `useCompositor({ sceneId, stream, ...runtimeOptions })`.
- Create and dispose `DOMRuntime` through a callback ref.
- Subscribe through `useSyncExternalStore` and expose a cached compositor snapshot.
- Provide a stable waiting snapshot for server rendering.

### 3. Move SSE consumption into the adapter

- Decode named setup/update/event messages.
- Preserve native EventSource reconnection behavior.
- Surface malformed payloads and application errors through hook state and `onError`.
- Abort and close EventSource before disposing a detached runtime.

### 4. Convert the studio

- Replace manual refs, effects, EventSource iteration, state, and cleanup with one hook call.
- Keep all existing DOM, asset, frame hydration, and persistence behavior unchanged.

### 5. Verify and document

- Unit-test cached snapshots, extracted methods, notification order, and disposal.
- Exercise the hook under the studio's React Strict Mode Playwright path.
- Document default/custom streams, tuple state, SSR, and direct runtime use.
- Run all six repository gates, the studio build, and Playwright.

## Acceptance criteria

- [x] `DOMRuntime` can be passed directly to `useSyncExternalStore`.
- [x] `const [ref] = useCompositor({ sceneId: "main" })` owns the complete browser lifecycle.
- [x] React remains optional for callers using the base package entry.
- [x] Custom AsyncIterable streams remain supported.
- [x] The studio retains SSE, assets, SSR frames, hydration, and iframe persistence.
- [x] All verification gates pass after documentation and reference updates.

## Verification result

Completed on 2026-07-15 with all six repository gates, 40 unit tests across 20 files, the studio
Vite production build, and all three browser Playwright tests passing. The studio runs in React
Strict Mode and verifies SSE snapshots, asset materialization, hydrated frames, and preserved iframe
navigation state through the new hook lifecycle.
