# Plan 013 — Recompose the host surface into a pull-based kernel

Status: DONE

## Objective

Replace the monolithic `ComposerHost` topology with a small set of independently constructible
kernel functions so any platform — Node, Vite dev, Cloudflare Workers with Durable Objects — can
own its event loop, its router, and its transports while the library owns only data flow. The
target usage is proven by the sketch in
`/Users/jameswilliams/Developer/experiments/obs-example` (`src/worker.tsx`,
`src/composition.tsx`, `src/composition-runtime.ts`, `vite.config.ts`), where a Durable Object
composes the pieces with Hono, `hono/streaming`, Hono RPC, and an `@xstate/store` domain store.

Nothing in this repository is a public dependency yet. Do not preserve superseded abstractions
for compatibility; delete them and migrate the examples.

## Why the current shape fails

The proof case is a Cloudflare Durable Object that had to bypass the library entirely
(the pre-sketch version of the example's `src/worker.tsx` reimplemented frame SSR, SSE encoding,
subscriber fan-out, and render orchestration by hand). Five root causes:

1. **The root's only awaitable is `render()`.** `packages/react/src/root.ts:108` — the commit/
   compile waiter machinery (`waitForCompile`, `#compileWaiters`) is reachable only through a
   full `render(element)` call. State that changes through `useSyncExternalStore` (the store-
   consumed-inside-React model) schedules React work that **no API can await**, so
   request/response hosts cannot get read-your-writes without re-rendering the whole element —
   which is why the example DO originally re-rendered on every mutation and chained renders
   through a `#mutation` promise.

2. **`ComposerHost` bundles what should compose.** `packages/server/src/index.ts` — one class
   owns the scene (rendered exactly once in `start()`, no sanctioned re-render or store path),
   the message hub, SSE `Response` construction (`#createRuntimeResponse`), frame routing,
   runtime connections, and an `EventTarget` lifecycle. A host that needs any one behavior to
   differ (a DO needs per-request origin, storage-backed state, and its own router) loses all of
   the others. Capabilities must be `input -> output` functions, not methods on a lifecycle
   object.

3. **Transports are constructed inside the library.** `#createRuntimeResponse` in
   `packages/server/src/index.ts` builds a `ReadableStream` + `Response`;
   `encodeRuntimeMessageSse` in `packages/core/src/sse-codec.ts:15` couples framing (`id:`,
   `event:`, `data:` lines) to encoding. Platforms like Hono (`streamSSE`) and Workers want the
   *codec* (`message -> {id, event, data}`) and want to own the wire loop:
   `for await (const m of messages) stream.writeSSE(toSseEvent(m))`.

4. **Setup/manifest ownership is misplaced and manual.** The asset manifest is passed to
   `ComposerHost` options and hand-published into the hub
   (`packages/server/src/index.ts` constructor; `examples/kitchen-sink/src/server/entry.tsx`
   `manifest: { version: 1, assets: [] }`). The manifest describes the *composition*, so the
   composer root should own it and emit `setup` itself — and the build already knows every
   fingerprinted asset, so the manifest should normally be derived, not hand-authored.

5. **Frame serving assumes a module-loading Node host and manual production wiring.**
   `packages/frame/src/vite.ts` serves frames only through Vite dev middleware +
   `ssrLoadModule`; production requires a hand-maintained client manifest host, explicit rollup
   inputs per frame, and a `frame-client-entry.ts`
   (`examples/kitchen-sink/vite.config.ts`, `src/server/entry.tsx`). Workers cannot load
   modules dynamically at all, and render-time registration
   (`FrameRegistrarProvider`, `packages/frame/src/view.tsx:40`) forces frame requests through
   whatever process rendered the scene — in the example that means waking a Durable Object to
   serve a stateless HTML document. The example proved the failure mode concretely: it
   hand-wrote `frame({ metadata })` with a `moduleUrl` that had already gone stale.

Additionally, `FrameProvider` (`packages/frame/src/view.tsx:20`) supplies the origin as a static
context value, so an origin change (dev hostname vs deployed hostname, discovered per request)
requires a host-driven re-render — the opposite of the store-consumed-inside-React model.

## Target usage (the contract this plan implements)

From the example sketch; imports must exist with these semantics when this plan is done:

```tsx
// Durable Object boot — three independent pieces, one render ever
const store = await restoreCompositionStore(this.ctx.storage);      // app state, @xstate/store
const scene = createSceneStore({ origin });                          // library plumbing store
const root  = createComposerRoot({ projectId, canvas, extensions, layoutEngine, assets, onError });
await root.render(
  <SceneProvider scene={scene}>
    <Composition store={store} />                                    // useSelector inside
  </SceneProvider>,
);

// Request handling — platform owns router and transport
scene.set({ origin });                                               // reactive, idempotent
streamSSE(c, async (stream) => {
  for await (const message of root.messages(c.req.raw.signal)) {
    await stream.writeSSE(toSseEvent(message));
  }
});
store.trigger.swap(c.req.valid("json"));
await root.settled();                                                // read-your-writes
c.json({ ...store.getSnapshot().context, revision: root.snapshot?.revision ?? 0 });

// Frames — stateless, build-derived, served at the worker edge
import { frames } from "virtual:vignette/frames";
const handleFrame = createFrameRequestHandler(frames);

// Assets — derived from the build, owned by the root
import { assets } from "virtual:vignette/assets";
```

Note one refinement over the sketch: the sketch's `createRuntimeHub(root).events(signal)`
collapses into `root.messages(signal)`. A separate hub object earns nothing once the root owns
setup and multiplexes subscribers itself; `RuntimeMessageHub` remains core-internal machinery.

## Implementation steps

### Stage 1 — core: codec split and no protocol changes

1. `packages/core/src/sse-codec.ts`: add
   `toSseEvent(message: RuntimeMessage): { readonly id: string; readonly event: RuntimeSseEvent; readonly data: string }`
   containing the current id/payload selection logic. Reimplement `encodeRuntimeMessageSse` as
   string framing over `toSseEvent`. `decodeRuntimeSseEvent` is unchanged; add a codec-pair test
   (`toSseEvent` → frame → parse → `decodeRuntimeSseEvent` round-trips all three message kinds).
2. `RuntimeMessage`, `SnapshotRuntime`, `consumeRuntimeMessages`, `AsyncQueue`, and
   `RuntimeMessageHub` are unchanged. The hub stops being a public integration point in docs but
   remains exported as the fan-out primitive the root uses.

### Stage 2 — react root: owns setup, pull-based, commit-awaitable

All in `packages/react/src/root.ts` unless noted.

1. Options: add `readonly assets?: AssetManifest` (default `{ version: 1, assets: [] }`). The
   root freezes it and publishes `{ kind: "setup", manifest }` into an internal
   `RuntimeMessageHub` at construction. Manifest is fixed for the root's lifetime; a changing
   manifest is a documented non-goal (record under "Deferred directions" in `plans/README.md`).
2. `publish()` (root.ts:214) additionally pushes `{ kind: "update", snapshot }` into the
   internal hub. `dispose()` closes it.
3. New members on `ComposerRoot`:
   - `messages(signal?: AbortSignal): AsyncIterable<RuntimeMessage>` — delegates to the internal
     hub's `subscribe(signal)`; each call replays setup + latest update then streams live.
   - `snapshots(signal?: AbortSignal): AsyncIterable<CompiledSnapshot>` — filtered view of
     `messages()` yielding only update payloads.
   - `publishEvent(event: RuntimeEvent): void` — pushes `{ kind: "event", event }`; keeps
     one-shot commands (invariant 8) out of snapshots while reusing the same pipe.
   - `get snapshot(): CompiledSnapshot | undefined` — replaces `getSnapshot()`; delete the
     method form and update all callers.
   - `settled(): Promise<CompiledSnapshot>` — the critical addition. Semantics: flush any React
     work scheduled by external stores, then resolve with the snapshot whose revision ≥ the
     current commit revision. Implementation: call `reconciler.flushSyncWork()` (verify the
     exact export on react-reconciler 0.33; it is the React 19 replacement for renderer-driven
     `flushSync`), then reuse `waitForCompile(this.#container.commitRevision)` and resolve with
     `this.#snapshot`. Reject on compile failure exactly as `render()` does.
4. Tests (`packages/react/src/root.test.tsx` and a new `settled.test.tsx`):
   - a component subscribed to a minimal external store via `useSyncExternalStore`; trigger a
     store change *outside* any `render()` call; assert `settled()` resolves with a snapshot
     reflecting the change (this also proves `useSyncExternalStore` works in the custom
     reconciler — a prerequisite for the `@xstate/store` consumption model);
   - two synchronous triggers before one `settled()` — resolves with the latest;
   - `settled()` with nothing pending resolves immediately with the current snapshot;
   - `messages()` late subscriber receives setup + latest update first;
   - `publishEvent` interleaves correctly and does not disturb replay state.

### Stage 3 — frame package: scene store, static registry, platform-neutral handler

1. New `packages/frame/src/scene.ts`:
   - `createSceneStore(config: { origin: string })` — a tiny synchronous external store:
     `get()`, `set(partial)`, `subscribe(listener)`. Origin normalization (currently
     `normalizeOrigin`, view.tsx:93) moves here and runs on every `set`.
   - `SceneProvider({ scene, children })` — reads the store with `useSyncExternalStore` and
     supplies origin through the existing context. Origin changes therefore re-render `<View>`s
     and re-derive frame URLs with no host orchestration.
   - Delete `FrameProvider` and `FrameRegistrarProvider`/`FrameRegistrar`. Registration moves to
     the build (step 3); `<View>` keeps its metadata guard but drops the registrar context read
     (view.tsx:70).
2. `packages/frame/src/server.ts`:
   - Change the handler signature to a single bundle:
     `createFrameRequestHandler(frames: { readonly registry: FrameRouteRegistry; readonly modules: FrameModuleHost })`.
   - Rename `ModuleHost` → `FrameModuleHost` and **delete `loadModule`**: every served frame
     comes from a live definition (registered by the virtual module or directly), so
     `loadFrameDefinition` and `registerFromTransform` are removed. `FrameRouteRegistry` keeps
     `registerDefinition` + collision checks only.
   - Extract pure kernel functions and export them: `renderFrameHtml(definition, metadata,
     rawProps): string` (validate → SSR → document) and `renderHydrationModule(modules,
     metadata): string`. The Fetch handler becomes URL parsing + these two calls. This gives
     hosts with their own routers the `frameId, params -> response` entrypoint directly.
   - Delete `createClientManifestModuleHost` (superseded by deterministic entry names, step 4).
3. Confirm `renderToString` works under `workerd` with `nodejs_compat` (the example's
   `wrangler.jsonc` already sets it). If it does not, switch the kernel to
   `renderToReadableStream` + stream collection behind the same pure function signature.
4. Delete `packages/frame/src/vite.ts` and `packages/frame/src/node-server.ts`'s manifest host
   re-export (keep the plain Node HTTP adapter if the kitchen sink still wants it; otherwise
   delete the file). Update `packages/frame/deno.json` exports accordingly.

### Stage 4 — new package `packages/vite`: `@strangecyan/vignette-vite` exporting `vignette()`

One plugin, environment-aware (Vite 8 environment API; must compose with
`@cloudflare/vite-plugin` and plain Node dev servers), emitting two virtual modules. Depends on
`@strangecyan/vignette-frame/transform` and `@strangecyan/vignette-core` types only.

1. **Transform**: apply `transformFrameDefinitions` (unchanged,
   `packages/frame/src/transform.ts`) to non-`node_modules` modules in every environment, as
   `vignetteFrames` does today (`toModuleUrl` logic carries over). Route keys stay deterministic
   because they hash `moduleUrl#exportName`.
2. **`virtual:vignette/frames`** (resolved id `\0virtual:vignette/frames`): generated code that
   - statically imports every discovered frame module (glob option, default
     `src/**/*.frame.{tsx,jsx}` under the config root),
   - constructs a `FrameRouteRegistry` and calls `registerDefinition` for each exported
     definition (transform metadata identifies exports; definitions are live because the import
     is real),
   - exports `frames = { registry, modules }` where `modules` is a `FrameModuleHost`:
     - dev: `resolveClientModule: (url) => url`, helper served as `/@fs/<frame client.js>`
       (logic from `createDevServerModuleHost`, `packages/frame/src/vite.ts:22`);
     - build: deterministic URLs (step 3).
3. **Deterministic client entries instead of a manifest.** In the client environment the plugin
   adds one rollup input per frame module plus one for the hydration helper, with fixed output
   names: `assets/vignette/frame/<routeKey>.js` and `assets/vignette/frame-client.js`
   (`entryFileNames` override scoped to these inputs, `preserveEntrySignatures: "strict"`).
   The worker-side `FrameModuleHost` then resolves URLs by pure string construction — no
   cross-environment manifest read, no build-order coupling, and it removes the kitchen sink's
   `frameModuleInputs()` and `frame-client-entry.ts`. Tradeoff to document: frame entry chunks
   are not content-hashed, so serve them `Cache-Control: no-store` (frame HTML already is).
4. **`virtual:vignette/assets`**: plugin option `assets?: string | readonly string[]` (globs).
   For each matched file compute a sha256 content hash; entry =
   `{ name: <root-relative path>, url, integrity: "sha256-<base64>" }`;
   `version` derives from the sorted entry hashes so runtime asset caches invalidate on any
   content change. URLs: dev — the plain root-relative path served by Vite; build — emit the
   file (`this.emitFile`) in the client environment under the deterministic name
   `assets/vignette/asset/<name>-<hash8><ext>` and reference that same computed string from
   every environment. No globs configured → `{ version: 1, assets: [] }`, preserving current
   behavior with zero config. Export ambient types for both virtual modules from
   `@strangecyan/vignette-vite/virtual` so consumers add one `types` reference instead of hand-writing
   `.d.ts` files (the example currently hand-writes `src/vignette-virtual.d.ts`).
5. **Dev serving for pure-Node setups**: `configureServer` middleware mounting the Stage 3 Fetch
   handler over the virtual registry (replaces `vignetteFrames`'s middleware). Cloudflare dev
   does not use this — the worker itself imports the virtual module and serves `/__vignette/*`
   through workerd, which is exactly the production path.
6. Tests: route-key parity between transform output and virtual-module registration; generated
   module snapshot for a fixture project with two frames; asset manifest determinism (same
   bytes → same version; changed bytes → changed version).

### Stage 5 — delete `packages/server`; migrate the kitchen sink

1. Delete `packages/server` entirely (`ComposerHost`, `ComposerErrorEvent`,
   `createNodeRequestHandler`). Its assembly role is now the examples' job; per the repository's
   own "findings considered and rejected" discipline, reintroduce a batteries package only when
   a second real consumer demands one.
2. Rewrite `examples/kitchen-sink` on the kernel:
   - `vite.config.ts`: `vignette()` replaces `vignetteFrames(frameRegistry)` + manual inputs;
     delete `src/frame-client-entry.ts` and `vite.ssr.config.ts`'s frames plugin usage.
   - `src/backend/plugin.tsx` and `src/server/entry.tsx`: replace `createComposerHost` with
     `createComposerRoot({ ..., assets })` + `root.render(<SceneProvider scene={sceneStore}>...`
     + Hono (`@hono/node-server`) routing: `/runtime` via `streamSSE` + `toSseEvent`,
     `/__vignette/*` via `createFrameRequestHandler(frames)`. OBS embedding becomes
     `consumeRuntimeMessages(obsRuntime, root.messages(signal))` — the existing core function,
     no `connect()` abstraction.
   - Keep `examples/simple` compiling against the root changes (rename `getSnapshot()` uses).
3. Update `docs/react-frames.md`, `docs/architecture.md`, `docs/deployment.md`, and package
   READMEs: hub/`ComposerHost` topology replaced by root-owned messages + platform transports;
   frames served from the build-time registry; assets derived via `virtual:vignette/assets`.

### Stage 6 — prove the Durable Object topology

1. Turn `/Users/jameswilliams/Developer/experiments/obs-example` from sketch to working app
   against the new packages (its `worker.tsx` documents the exact expected imports:
   `root.messages`/`settled`/`snapshot`, `toSseEvent`, `createSceneStore`/`SceneProvider`,
   `virtual:vignette/frames`, `createFrameRequestHandler`). The `@xstate/store` +
   `sValidator`/Hono RPC layers are application code and need no library support beyond
   `settled()` — verify that boundary holds.
2. Add a `examples/cloudflare-do` (or adopt the external example as a workspace member) with a
   Playwright smoke test: boot `wrangler dev`, assert `/api/state`, a swap round-trip with
   monotonic revision, SSE replay on `/api/runtime`, and frame HTML + hydration module under
   `/__vignette/frame/<routeKey>` — served without instantiating the Durable Object (assert via
   a request before any `/api/*` call).

## Acceptance criteria

- A state change made through an external store (no `render()` call) is awaitable via
  `settled()` and observable in `messages()` subscribers, with monotonic revisions.
- `root.messages(signal)` gives every late subscriber setup + latest update first; abort cleans
  up the subscription (no leaked queues).
- The SSE wire format is byte-identical to today's (`encodeRuntimeMessageSse` output unchanged)
  so `sseRuntimeSource` in `target-dom` needs no changes.
- A frame request is served from the static registry in dev and prod with working hydration, in
  both the Node kitchen sink and the Workers example, with no per-frame config in any
  `vite.config.ts`.
- `virtual:vignette/assets` produces a deterministic, content-versioned manifest and the root
  emits it in `setup`; no example hand-writes `{ version: 1, assets: [] }`.
- `packages/server`, `FrameProvider`, `FrameRegistrarProvider`, `ModuleHost.loadModule`,
  `registerFromTransform`, and `vignetteFrames` no longer exist in the tree.
- All six repository gates pass; kitchen-sink Playwright and the new DO smoke test pass.

## Stop conditions

- Stop if react-reconciler 0.33 exposes no reliable way to flush externally-scheduled work
  (`flushSyncWork` or equivalent) such that `settled()` cannot be made deterministic — do not
  ship a timer/polling fallback; escalate with findings instead.
- Stop if `renderToString`/`renderToReadableStream` cannot run under workerd with
  `nodejs_compat`; do not move frame SSR back into a Node-only seam without recording the
  constraint.
- Stop if deterministic (non-hashed) client entry names conflict with
  `@cloudflare/vite-plugin`'s output handling; do not silently fall back to a build-order-
  dependent manifest read across environments.
- Do not add a WebSocket transport, OBS runtime changes, or manifest hot-swapping in this plan.
