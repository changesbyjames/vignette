# Plan 014 — Refactor to the README vision

Status: PROPOSED

Companion to `README.vision.md`, which is the specification. Where this plan and the README
disagree, the README wins and this plan is wrong. Where the README is silent, this plan records a
decision and marks it `DECISION`. Items marked `README FIX` are places where the README promises
something the underlying systems cannot deliver and the README should change.

Nothing in this repository is a public dependency. Do not preserve superseded abstractions; delete
them and migrate the examples.

---

## 0. Ground rules for the refactor

1. **Delete first, then build.** Every section below has a "rip out" list. Removing those before
   writing replacements keeps the replacement honest: if something still compiles only because an
   old helper exists, the old helper has leaked into the new design.
2. **One mechanism per job.** One stream parser, one asset store shape, one target contract, one
   status type, one validation library, one way to register a source kind.
3. **Explicit state machines.** Every component that today tracks its lifecycle with a cluster of
   boolean and counter fields becomes a pure `reduce(state, event) → { state, effects }` plus a
   thin effect runner. Section 6 specifies each machine. Tests drive the reducer directly.
4. **Core stays free of I/O.** `vignette` (composer, data model, `defineSource`, snapshot codec)
   imports nothing from Node, DOM, HTTP or OBS. Enforced by lint, not by package boundaries.
5. **Hosts state locations; the library never derives them.** `serve` in setup is the only way a
   target learns where anything is.
6. **The stream is the only channel.** No side protocols, no second SSE endpoints.

---

## 1. Vocabulary mapping

| Today                                   | Vision                                            |
| --------------------------------------- | ------------------------------------------------- |
| composition, `defineComposition`        | show, `<Show>` element                            |
| `Broadcast`, `Sources`, `Scene`, `Box`, `Layer`, `SceneLayer`, `Source`, `BrowserView` | `Show`, `Scene`, `Layer`, `Use`, source components |
| `projectId`                             | show `id`                                         |
| composer root, `createComposerRoot`, `compile` | composer, `compose()`, `composer.once()`      |
| `RenderTarget` + `TargetRuntime`        | target, from `createTarget`                       |
| `DOMRuntime`, `DomTarget`, `useStage`   | `vignette/react` (`Stream`, `Stage`) and `vignette/dom` (`domTarget`) |
| `OBSRuntime`, `ObsConvergenceScheduler`, `createObsTarget*` | `obsTarget`                        |
| `SourceModule` + `DomSourceRenderer` + `ObsSourceCodec` + React component | `defineSource` + `ReactSourcePlugin` + `DomSourcePlugin` + `ObsSourcePlugin` |
| extension, codec, renderer              | plugin                                            |
| `StreamSetup.extensions`                | `setup.kinds` (kinds in use) + `setup.serve`      |
| `StreamEvent` `scene:select`            | `activeScene` on the snapshot; events are open    |
| frame `View`, hydration, remote store   | `Frame` source kind, `mountFrames`, static page   |
| asset manifest with URLs                | manifest with names and hashes                    |
| `baseUrl`, `browserSourceBaseUrl`       | `serve.{stream,assets,frames}` in setup           |

---

## 2. Package topology

### Vision

One published package `vignette` with subpath exports: `.`, `./react`, `./dom`, `./obs`,
`./obs/testing`, `./frame`, `./frame/mount`, `./bundle`, `./vite`, `./yoga.wasm`, and the
`vignette` bin (not an export; V10). `@vignette/moq` stays a separate example package.

### Today

Nine workspace packages, each with its own `package.json`, `tsconfig`, build, README and
`exports`. Cross-package imports via `workspace:^`. Architecture boundaries are enforced by package
dependency direction.

### Decision

`DECISION` Collapse to one package at `packages/vignette` with `src/{core,react-authoring,compose,
stream,target,obs,react,dom,frame,bundle,vite,cli}`. Replace package-boundary enforcement with an
oxlint `no-restricted-imports` ruleset per directory (core may not import from obs, dom, react,
frame, bundle, vite, cli, or from `node:*`; obs may not import dom or react; and so on). The
`AGENTS.md` architecture section is rewritten to describe directory boundaries.

Reasons: nine packages exist to separate environments, and subpath exports with `"browser"` /
`"node"` conditions do that with one `package.json`. The publish scripts, per-package READMEs,
`check-npm-packages.mjs` and the dependency ordering in `docs/publishing.md` all go away.

### Rip out

- `packages/{core,react,target-dom,target-obs,frame,vite,cli}/package.json`, `tsconfig.json`,
  `README.md`.
- `scripts/check-npm-packages.mjs`, `scripts/publish-npm-packages.mjs` (rewrite for one package).
- `docs/publishing.md` package-ordering section.
- `tsconfig.base.json`: `exactOptionalPropertyTypes: true`. `DECISION` turn it off. It is the
  reason for 59 `omitUndefined` calls and for every `?: T | undefined` in public option types.
  Delete `omitUndefined` and `DefinedProperties` from `objects.ts` once the flag is off.
- `ramda` dependency (used for `equals` and `clamp` only; inline both).

### Keep

- `packages/testkit` as a private workspace package (`@vignette/testkit`), see section 4.17.
- `packages/moq` as the public example plugin package, renamed `@vignette/moq`.
- `examples/*`.
- Tooling: oxlint, oxfmt, vitest, playwright, `tools/oxlint` house rules.

---

## 3. Piece-by-piece gap analysis

Each piece: what the README requires, what exists, what to keep, what to rip out, what to build.

### 3.1 Snapshot data model (`core/snapshot.ts`, `core/authoring.ts`, `core/sources.ts`)

**Vision.** Snapshot = `{ revision, id, canvas, activeScene?, sources, scenes }`. A source is
`{ id, kind, props, size }`. A scene is `{ id, items }`. An item is a laid-out layer
`{ id, sourceId, frame, placement, visible, opacity, rotation, clip? }`. Sources are either inline
(one per layer, ID derived from the layer) or shared (declared at show level, placed by `<Use>`).

**Today.** `CompiledSnapshot` has `projectId`, `sources: CompiledSource[]` where a source carries
a kind-discriminated `definition` object plus optional `intrinsicSize` and `asset`; items have
`content: {kind:"source"|"scene"}` to support nested scenes; `warnings: Diagnostic[]`. The
authoring graph (`authoring.ts`) is a separate node tree (`BroadcastNode`, `SourcesNode`,
`SceneNode`, `BoxNode`, `LayerNode`, `SceneLayerNode`) that the React host tree is lowered into
before compilation.

**Keep.**

- `geometry.ts`, `content-fit.ts`, `rounding.ts` (pure, tested, correct).
- `LayoutStyle` type and its Yoga mapping in `layout/style.ts`.
- The snapshot-is-plain-frozen-data principle and `deepFreeze` at the core→target boundary.

**Rip out.**

- `CompiledItemContent` union and nested-scene items. `DECISION` nested scenes (`SceneLayer`) are
  not in the README. Remove them. They cost: `validateSceneCycles`, `clipForBox` inheritance,
  `patchNestedScene` in the DOM target, `ObsSceneContentRef` and scene-as-source planning in OBS,
  and `collectSceneSourceIds` recursion. If they come back it will be as `<Use scene>` with the
  same shared-source machinery, not as a separate item kind.
- `CompiledSource.definition` / `AnySourceDefinition` / `SourceKinds` closed registry. Replace with
  `{ kind: string, props: unknown }` validated by the kind's zod schema.
- `CompiledSource.asset`. Asset references live inside `props` (an `Image` prop `src` becomes an
  asset name) and the kind's definition declares which props are assets (3.4).
- `warnings` on the snapshot. Diagnostics are composer status, not stream payload. `README FIX`
  none needed; the README never shows warnings in snapshots.
- `authoring.ts` node types, `builders.ts` (programmatic node constructors), `BroadcastCanvas`.
  The React host tree lowers directly into the compiler input (3.5); there is no intermediate
  authoring graph to build by hand. The `<Source definition={…}>` escape hatch is replaced by the
  fact that `defineSource` components accept any props object.
- `sources.ts` built-in source interfaces (`ImageSource`, `BrowserSource`, …). They become the zod
  schemas inside each built-in's `defineSource`.
- `DEFAULT_BROWSER_SOURCE_CSS` moves to the OBS browser plugin and the frame page template.

**Build.**

- `core/snapshot.ts`: the new shapes above, plus `SnapshotSchema` (zod) which is the single source
  of truth for both the TypeScript types (`z.output`) and wire decoding. Delete `wire-schemas.ts`
  as a separate file; it *is* the model.
- `activeScene?: string` on the snapshot.

### 3.2 Validation and diagnostics (`core/validation.ts`, `core/diagnostics.ts`, `core/ids.ts`)

**Vision.** Errors at authoring boundaries become diagnostics in composer status. Source props are
validated by each kind's schema. Structural rules (duplicate IDs, dangling `<Use>`, missing
`serve`) are composer checks.

**Today.** 517 lines of hand-rolled validation covering IDs, canvas, layout style values, crop,
presentation props, repeated placements, scene cycles, plus per-kind checks delegated to
`SourceModule.validate`. A parallel zod layer in `wire-schemas.ts` validates the same shapes on
the wire. Diagnostic codes are a 22-member closed union.

**Keep.**

- `Diagnostic` shape `{ code, severity, path, message, relatedIds? }` and `diagnostic()` helper.
- `isStableId` and `STABLE_ID_RULE`.
- The sorting of diagnostics by path for determinism.

**Rip out.**

- `validateLayoutStyle`, `validateEdges`, `validateLength`, `validateCrop`,
  `validateLayerPresentation`, `validateCanvas`, `validateSource`: replaced by zod schemas
  (`LayoutStyleSchema`, `LayerPropsSchema`, `CanvasSchema`, per-kind `props`). Zod error paths
  map onto `Diagnostic.path`.
- `validateSceneCycles`, `walkSelectedNodes`, `walkAllNodes`: no nested scenes.
- `validateRepeatedPlacements` / `V1_REPEATED_PLACEMENT`: inline sources make each layer its own
  source, so the only remaining case is `<Use source="x">` twice in one scene. Keep that one check
  under a new name `DUPLICATE_PLACEMENT`. See 3.9 for why OBS cannot support it.
- Diagnostic codes `UNKNOWN_SOURCE_KIND` (the composer cannot encounter one; a `defineSource`
  component carries its own kind), `INVALID_BROWSER_URL`, `INVALID_SOURCE_SIZE`,
  `INVALID_SOURCE_SETTING` (all now `INVALID_PROPS` with a zod path), `SCENE_CYCLE`,
  `MISSING_SCENE`, `TARGET_LAYOUT_DIVERGENCE`, `UNREACHABLE_SOURCE`,
  `UNSUPPORTED_TARGET_CAPABILITY` (3.8 replaces capabilities with plugin presence).
- `ValidationResult` (`valid/errors/warnings` split): return `Diagnostic[]`; callers filter.

**Build.**

- `core/validate.ts` (~120 lines): structural checks only. Duplicate scene IDs, duplicate layer IDs
  within a scene, duplicate shared-source IDs, `<Use>` of an undeclared source,
  `DUPLICATE_PLACEMENT`, missing `serve.assets` when an asset-bearing kind is used, missing
  `serve.frames`/`serve.stream` when `frame` is used, `activeScene` naming an unknown scene.
- New codes: `INVALID_PROPS`, `DUPLICATE_PLACEMENT`, `MISSING_SERVE`, `UNKNOWN_ACTIVE_SCENE`.

### 3.3 Layout compiler (`core/layout/*`)

**Vision.** Yoga lays out layers; the compiler emits absolute frames and content placement. Yoga
ships as wasm loaded by import; hosts that cannot import wasm pass `layout`.

**Today.** `compile-layout.ts` (388 lines) does validation, layout, source default application,
content fit, clip inheritance, nested-scene handling and diagnostic sorting in one pass.
`yoga-runtime.ts` adapts Yoga nodes; three entrypoints exist for Node, wasm and workerd.

**Keep.**

- `yoga-runtime.ts` style application and the `LayoutEngine` seam (`layout(nodes, canvas) →
  records`). This is the one place Yoga is touched and it is right.
- `content-fit.ts`, `rounding.ts` unchanged.
- `compileLayer` / `fitSourceLayer` logic for turning a frame plus source size into placement.

**Rip out.**

- Validation calls inside the compiler (3.2 owns them; compiler assumes valid input).
- `applySourceDefaults` / `SourceDefaultsContext` / `distinctSizes` browser-viewport inference.
  Replaced by `defineSource.size(props, { canvas, layer })` where `layer` is the laid-out frame of
  the placing layer; for a shared source placed at several sizes, `size` is called once with
  `layer: undefined` and the kind decides (the browser kind then requires `viewport`). Simpler
  than today's "collect every placement and demand agreement" and matches the README's
  "viewport defaults to the layer size".
- `clipForBox` inherited clipping across nested scenes. Keep clipping to the canvas only.
- `layout-yoga-workerd.ts`, `layout-yoga-wasm.ts`, `./yoga.wasm` export. `DECISION` one
  entrypoint that `import`s the wasm (bundler-visible). `loadYoga()` exported for hosts that must
  initialise by hand. Verify `yoga-layout@3` supports this with its `/load` entry; if not, keep two
  entrypoints and document, and amend the README's host table.

**Build.**

- `core/layout/compile.ts` (~200 lines): input is the lowered show tree (3.5), output is the
  snapshot. No validation, no defaults, no diagnostics beyond `LAYOUT_COMPILE_FAILED`.

### 3.4 Source kinds and the plugin seam (`core/source-module.ts`, `core/capabilities.ts`, `dom/elements/*`, `obs/codecs/*`)

**Vision.** `defineSource({ kind, props: zodSchema, size, assets? })` returns a typed React
component. Each target has its own plugin interface (`ReactSourcePlugin`, `DomSourcePlugin`,
`ObsSourcePlugin`) with a create / update / dispose lifetime. Built-ins are implemented through
the same interfaces. Setup lists the kinds in use; a target without a plugin for one reports it
before touching anything.

**Today.** Four facets registered in four places (3.4 of the assessment). `SourceModule` carries
`entrypoints` so setup can advertise where to import a facet from. `Capability` is a closed
union; `requiredCapabilities(snapshot)` and `TargetCapabilities` are a second mechanism for the
same question. `describeMissingExtensions` builds remediation strings from entrypoints.

**Keep.**

- The idea of `SourceModule.intrinsicSize` → `defineSource.size`.
- `selectInputKind(candidates, available)` for OBS plugins that accept several input kinds.
- The MoQ package as the worked example (rewritten, 3.16).

**Rip out.**

- `source-module.ts` entirely: `SourceModule`, `SourceModuleMap`, `resolveSourceModules`,
  `extensionSourceKinds`, `invalidSourceSize`, `invalidHttpUrl`, `invalidResourceUrl`,
  `BUILTIN_SOURCE_MODULES`, `imageSourceModule`, `mediaFileSourceModule`,
  `browserSourceModule`, `colorSourceModule`.
- `capabilities.ts` entirely: `Capability`, `TargetKind`, `UnsupportedPolicy`,
  `TargetCapabilities`, `TargetPhase` (moves to target kernel), `TargetStatus` (moves),
  `TargetApplyReceipt`, `RenderTarget`, `requiredCapabilities`.
- `describeMissingExtensions`, `ExtensionSourceKind`, `SourceModuleEntrypoints`,
  `TARGET_EXTENSION_LABELS`.
- `dom/elements/types.ts` `DomSourceRenderer` / `DomSourceView` / `DomRendererContext` (replaced
  by `DomSourcePlugin`, same shape with `load/create/update/dispose`, renamed and simplified).
- `obs/codecs/types.ts` `ObsSourceCodec` / `ObsCodecContext` / `ObsCodecResult`. Replaced by
  `ObsSourcePlugin` whose `create` is async and returns a handle `{ input: { kind, settings },
  update?, dispose?, event? }`.
- `react/source-element.ts` `sourceElement`, `SourceProps`, `AllowUndefined`,
  `structuredClone`+`deepFreeze` of props. `defineSource` owns component creation; the host
  element receives `{ kind, props }` and the composer validates with the schema.

**Build.**

- `core/define-source.ts`:
  ```ts
  interface SourceDefinition<P> {
    kind: string;
    props: ZodType<P>;
    size(props: P, ctx: { canvas: Size; layer?: Size }): Size;
    /** Prop paths whose values are asset names, so the composer can list required assets. */
    assets?: readonly (keyof P)[];
  }
  function defineSource<P>(def): SourceComponent<P>   // React component + `.definition`
  ```
  The returned component is `(props: P & { id?: string }) => createElement("source", { kind,
  props, id })`. Static `Moq.definition` lets plugin types say `ReactSourcePlugin<typeof Moq>`.
- `target/plugins.ts`: `SourcePluginBase { kind }` and the per-target interfaces live beside each
  target (`react/plugin.ts`, `dom/plugin.ts`, `obs/plugin.ts`). The kernel (3.8) is generic over
  the handle type.
- Built-ins: `core/sources/{color,image,video,browser,frame}.ts` definitions;
  `react/sources/*.tsx`, `dom/sources/*.ts`, `obs/sources/*.ts` plugins. Registered by default in
  each target's plugin list; `builtins: false` to opt out.
- Setup message gains `kinds: string[]` (kinds present in the show, built-in or not). Target
  kernel checks each against its plugin map; missing kinds → `error` status
  `missing source plugin for kind "x"`.

### 3.5 React authoring (`react/primitives.ts`, `host-types.ts`, `host-tree.ts`, `host-config.ts`, `composition.ts`)

**Vision.** `<Show id canvas activeScene?>`, `<Scene id>`, `<Layer style fit align crop opacity
rotation visible id?>`, source components, `<Use source>`. Layers nest for layout. Inline sources
take their layer's ID. Layer IDs are derived from tree path unless explicit.

**Today.** `Broadcast` + `Sources` + `Scene` + `Box` + `Layer sourceId` + `SceneLayer` + `Source
definition` + `BrowserView`; eight host types; `HostProps` is a bag of `unknown`; `hostTreeToBroadcast`
lowers to the authoring graph with `collectBrowserViewSources` special-casing. `defineComposition`
is a separate frozen object carrying `id`, `canvas`, `extensions`, `component`.

**Keep.**

- `host-config.ts` almost verbatim. It is a correct, minimal mutation-mode host config. Only
  `HostType` and `Props` generics change.
- `host-tree.ts` mutation helpers (`insertHostChild` and friends) and the cycle guards.
- `reconciler.ts`.

**Rip out.**

- `primitives.ts`: `Broadcast`, `Sources`, `Box`, `SceneLayer`, `Source`, `BrowserView`,
  `ImageSource`/`MediaSource`/`BrowserSource`/`ColorSource` wrappers (3.4 builds them via
  `defineSource`), `presets.ts` (`fill` etc.; README rejects layout helpers).
- `host-types.ts` `HostType` members `broadcast`, `sources`, `box`, `scene-layer`,
  `browser-view`. New set: `show`, `scene`, `layer`, `source`, `use`.
- `HostProps` as a bag of `unknown` keys. Replace with a discriminated `HostProps` per type; the
  reconciler already knows the type at `createInstance`.
- `composition.ts` `defineComposition`, `CompositionDefinition`. `<Show>` carries `id`,
  `canvas`, `activeScene`. `compose()` takes an element or a component.
- `hostTreeToBroadcast` → `host-tree.ts#lowerShow(container) → ShowTree` (compiler input).
  `collectBrowserViewSources`, `toSources`, `optionalProps`/`required` reflection helpers.

**Build.**

- `react-authoring/elements.tsx`: `Show`, `Scene`, `Layer`, `Use` (typed props, no `unknown`).
- `react-authoring/lower.ts`: walk the host tree once, producing
  `{ id, canvas, activeScene, sharedSources, scenes: [{ id, root: LayoutNode }] }` where a
  `LayoutNode` is `{ id, style, props, children } | { id, style, props, source }`. Inline source
  under a layer becomes `source: { id: layer.id, kind, props }`. `<Use>` becomes
  `source: { ref: id }`. A layer with both a source child and layer children is a diagnostic
  (`LAYER_HAS_BOTH`).
- **Derived IDs.** `DECISION` derive from the path of *sibling index within parent* plus type:
  `scene.main/0/1`. This is deterministic and needs nothing from React. Consequence: reordering
  siblings changes derived IDs. `README FIX` the identity section currently claims "reordering
  within the same parent keeps identity"; change to "reordering siblings needs explicit `id`",
  matching the list guidance already there. Alternative considered: deriving from React `key`,
  rejected because invariant 3 says React keys never identify remote resources and because the
  reconciler does not expose keys to the host config.
- `<Show>` must be the root; a non-`show` root child is a diagnostic. `<Scene>` must be a direct
  child of `<Show>`; shared sources are direct children of `<Show>`.

### 3.6 Composer (`react/root.ts`, `react/status.ts`)

**Vision.** `compose(show, { assets, serve, layout, onError })` returns `{ stream, snapshot,
ready, settled, once, emit, status, subscribe, dispose }`.

**Today.** `ComposerRootImpl` (443 lines): render / compile waiters keyed by revision,
`renderRejectors`, `renderFailures` map, `compileFailure`, `compileScheduled`, `compiledRevision`,
`disposed`, an internal `StreamHub`, a `ComposerStatusStore`, `snapshotListeners` (push API) *and*
`messages()` (pull API), `getStatus`/`subscribeStatus`, `unmount`, `CommitReceipt` objects. `compile()`
one-shot helper. Lazy default layout-engine import.

**Keep.**

- The reconciler container bookkeeping: `commitRevision`, `commitActive`, `onCommit` in
  `resetAfterCommit`. This is how the composer learns a commit happened.
- `settled()`'s `flushSyncFromReconciler` + `flushSyncWork` + wait-for-compile sequence; it is
  the proven answer to "await external-store updates".
- Microtask-coalesced compile after commit.
- `StreamHub` (55 lines) and `AsyncQueue` (55 lines). Both are small, correct, and exactly what
  `stream(signal)` needs. Keep in `stream/`.
- Lazy loading of the layout engine when `layout` is not supplied.

**Rip out.**

- `subscribe(listener: (snapshot) => void)` push API; `snapshots()` filtered iterable;
  `CommitReceipt`; `unmount()` as public; `getStatus()`+`subscribeStatus()` pair (replaced by
  `status` getter + `subscribe()` with `useSyncExternalStore` shape); `ComposerStatusStore` class
  (inline a 15-line store); `renderRejectors`/`renderFailures`/`compileFailure` trio.
- `compile()` standalone → `composer.once()`.
- `ComposerRootOptions.strictMode` (`DECISION` always off; React strict mode double-invokes
  effects, which in a server composer means double timers. Remove the option.)

**Build.**

- `compose/compose.ts`: thin shell over an explicit machine (6.1). It owns the reconciler root,
  the `StreamHub`, the manifest, and publishes `setup` once at construction with
  `{ id, canvas, kinds, assets, serve }`.
- `compose/status.ts`: `ComposerStatus = { phase: "idle"|"compiling"|"ready"|"error"|"disposed",
  revision, compiledRevision?, diagnostics, error? }`.
- `ready()` = first `ready` phase; `settled()` = flush + wait for `compiledRevision >=
  commitRevision`; `once()` = render, settled, dispose.
- `emit(event)` publishes `{ kind: "event", event }` on the hub.

### 3.7 Stream (`core/stream.ts`, `core/stream-hub.ts`, `core/sse-codec.ts`, `core/async-queue.ts`, `target-dom/sse.ts`, `target-obs/sse.ts`, `cli/load-snapshot.ts`)

**Vision.** Messages are `setup | update | event`. Setup carries `{ id, canvas, kinds, assets,
serve }`. `toSseEvent` and `fromSse` are helpers; any async iterable works. Targets never guess
URLs.

**Today.** Setup carries `{ projectId, manifest (with URLs), extensions (with entrypoints) }`.
`sse-codec.ts` has `toSseEvent` (good) and `encodeStreamMessageSse` (string framing; fine). SSE
*parsing* is implemented three times: `target-dom/sse.ts` (EventSource), `target-obs/sse.ts`
(fetch + hand parser + reconnect), `cli/load-snapshot.ts` (fetch + a second hand parser).
`consumeStream(runtime, iterable)` dispatches to `setup/update/event`. `StreamSource` is a
callable with an optional `url` so `useStage` could default `baseUrl` from it.

**Keep.**

- `StreamMessage` union shape; `toSseEvent`; `encodeStreamMessageSse`; `decodeStreamSseEvent`
  (retargeted at the new schemas); `StreamHub`; `AsyncQueue`.

**Rip out.**

- `target-dom/sse.ts`, `target-obs/sse.ts`, the SSE parsing half of `cli/load-snapshot.ts`
  (`readSseSnapshot`, `parseSseRecord`, `sseBoundary`, `isRuntimeEvent`).
- `StreamSource` type with `.url`. A stream is `AsyncIterable<StreamMessage>`.
- `consumeStream` → `target.follow(iterable)` on the kernel (3.8).
- `StreamSetup.manifest.assets[].url`, `StreamSetup.extensions`.

**Build.**

- `stream/sse.ts`: one `fromSse(input: string | URL | Response | ReadableStream<Uint8Array>,
  { signal?, retry? }) → AsyncIterable<StreamMessage>`. Fetch-based so it works in Node and
  browsers; reconnects with backoff when given a URL; a `Response`/stream is consumed once. Uses
  one boundary scanner. `README FIX` none; the README already says `fromSse(url)` and
  `fromSse(await fetch(url))`.
- `stream/messages.ts`: `SetupSchema`, `EventSchema`, `MessageSchema` (zod) → types.
- `setup.serve: { stream?, assets?, frames? }`, `setup.kinds: string[]`, `setup.assets:
  { version, entries: [{ name, hash }] }`.

### 3.8 Target kernel (`core/stream.ts#TargetRuntime`, `core/capabilities.ts#RenderTarget`, both runtimes' setup gating, both asset stores, both status stores)

**Vision.** `createTarget<Handle>({ kind, sources?, builtins?, update(snapshot, handles),
event? })` provides setup checks, the asset stage, the plugin lifetime, status, settlement and
`follow/apply/dispose`. Every target has the same contract.

**Today.** Two layered contracts (`RenderTarget` with `publish/whenSettled/getStatus/subscribe`,
`TargetRuntime` with `setup/update/event`). Each runtime wraps its target and re-implements:
setup gating (`hasSetup`, `setupFailure`), extension checks, asset store construction, status
merge. Two asset stores (`DomAssetStore` with blob URLs and manifest validation; `ObsAssetStore`
with temp files and the same validation). Two status stores. Two settlement-waiter
implementations (`SettlementWaiter` sets in `DomTarget` and `ObsConvergenceScheduler`).

**Keep.**

- The *behaviour* of settlement by revision (`whenSettled(rev)` resolves when
  `settledRevision >= rev`), latest-wins coalescing of pending snapshots, and microtask-coalesced
  draining. These become kernel code, written once.
- Asset integrity check (sha256) and the "download new manifest fully before swapping" rule from
  `DomAssetStore.setup`.

**Rip out.**

- `TargetRuntime`, `RenderTarget`, `TargetApplyReceipt`, `TargetCapabilities`.
- `DOMRuntime` and `OBSRuntime` wrapper classes.
- `DomAssetStore`, `ObsAssetStore`, `DomAssetRegistry` (`media-registry.ts`), `AssetResolver`,
  `AssetResolutionContext`, `ResolvedAsset`, `AssetTargetKind`, `validateAssetName` (names are
  whatever the manifest says; the manifest is produced by `bundle`/`scanAssets`, which validate).
- `DomSourceRegistry` (`source-registry.ts`) retain/park logic: the kernel's handle map plus the
  React/DOM plugin lifetime covers it.
- `ObsStatusStore`, the `listeners` set in `DomTarget`, the `serverSnapshot` in `DOMRuntime`.

**Build.**

- `target/kernel.ts`: implementation of machine 6.2. Generic over `Handle`. Owns:
  - plugin map (`Map<kind, Plugin>`), built-ins merged unless `builtins: false`;
  - `AssetStore` interface `{ ensure(entries): Promise<void>; resolve(name): Resolved; evict(keep);
    dispose() }` with two implementations in `dom/asset-store.ts` (object URLs) and
    `obs/asset-store.ts` (files), each ~60 lines, no validation, keyed by hash;
  - handle lifecycle: diff `snapshot.sources` against the handle map by `id`; create (async, with
    `preparing` status), update, dispose;
  - update queue: latest-wins; held while in `downloading-assets` or while any handle is
    `preparing` for a source the current scene needs (`DECISION` the README says "the rest of
    the scene converges around it"; implement as: apply the snapshot with pending handles marked
    `preparing`, let the medium's `update` render a placeholder, re-apply when they resolve);
  - status store and `subscribe` in `useSyncExternalStore` shape; `settled(rev)`.
- `target/status.ts`: one `TargetStatus = { phase, revision: { desired?, settled? }, assets?:
  { done, total, failed }, sources: Record<id, "preparing"|"live"|"error">, error? }`.

### 3.9 OBS target (`target-obs/*`)

**Vision.** `obsTarget({ url, password, assets?, frames?, sources?, builtins?, retry? })`.
Reads `serve` from setup. Converges with a dependency-ordered plan. Sets program scene from
`activeScene`. Never touches resources outside `vignette/<show>/…`. Status phases observable.

**Today.** `ObsConvergenceScheduler` (563 lines, 15 state fields), `planner.ts` (879),
`executor.ts` (322), `operations.ts` (292), `observed-state.ts`, `bootstrap.ts`, `events.ts`,
`naming.ts`, `errors.ts`, `wire-schemas.ts`, `obs-websocket-transport.ts`, `transport.ts`,
`create-obs-target.ts` (three constructors), `runtime.ts`, `capabilities.ts`
(`REQUIRED_OBS_REQUESTS`), `status-store.ts`, codecs for browser/color/media/image.

**Keep.**

- `transport.ts` `ObsTransport` seam and `obs-websocket-transport.ts`. Exactly right.
- `bootstrap.ts` observation (trim: no `canvasUuid`, use one zod schema for responses).
- `observed-state.ts` indexing of managed resources.
- `naming.ts` scheme: registry scene, `vignette/<show>/<scene>`, `vignette/<show>/<source>`.
- `operations.ts` plan vocabulary and `validateOperationDependencies`; `OBS_PHASES` ordering.
- `executor.ts` batching and interruption checks.
- `planner.ts` core algorithm: create scenes, prepare inputs, plan scene items, prune, dependency
  validation. Trim the parts below.
- `errors.ts` error classes and `readObsErrorCode`.
- `events.ts` subscription list.
- Retry/backoff parameters and the `ObsSchedulerRuntime` clock seam (rename `ObsClock`).

**Rip out.**

- `runtime.ts` (`OBSRuntime`), `create-obs-target.ts` (all three constructors),
  `status-store.ts`, `capabilities.ts` (fold `REQUIRED_OBS_REQUESTS` check into bootstrap as a
  diagnostic), `asset-store.ts` (kernel-shaped store replaces it), `sse.ts`, `codecs/*` (become
  `sources/*` plugins), `wire-schemas.ts` (fold into bootstrap).
- `ObsConvergenceScheduler` class. Its *behaviour* is re-expressed as machine 6.3 plus an effect
  runner of ~120 lines.
- Planner: `ObsSceneContentRef` and nested-scene planning; `collectBrowserGeometries` /
  `realizeBrowserGeometry` / `browserViewport` (browser viewport is now resolved by the kind's
  `size` in the composer and arrives in `source.size`); `browserSourceBaseUrl` input;
  `resolvedAssets` map input (plugins resolve through context); `refreshProperty` press-button
  flow (`DECISION` drop; it existed to force browser-source refresh after settings change and
  OBS reloads on URL change anyway. Re-add as an opt-in plugin handle member if needed).
- `event()`'s `SetCurrentProgramScene` on `scene:select`. Replaced by planner emitting a
  `set-program-scene` operation when `snapshot.activeScene` differs from observed program scene
  (new observed field from `GetCurrentProgramScene`).

**Build.**

- `obs/target.ts`: `obsTarget(options)` = `createTarget<ObsHandle>` with the OBS machine driving
  connection, observation and plan execution inside `update`.
- `obs/plugin.ts`: `ObsSourcePlugin<Def> { kind; create(source, ctx): ObsHandle | Promise<ObsHandle> }`,
  `ObsHandle { input: { kind, settings }; update?(source): void|Promise<void>; dispose?(): void|
  Promise<void>; event?(event): void|Promise<void> }`. Context: `{ assets, frames, canvas,
  inputKinds, port, signal }`.
- `obs/sources/{color,image,video,browser,frame}.ts`. `frame` plugin builds
  `${serve.frames}?frame=${name}&source=${id}&stream=${encode(serve.stream)}` and emits a
  `browser_source` input.
- Planner input becomes `{ desired: Snapshot, observed, handles: Map<id, ObsHandle> }`; it reads
  `input.kind` and `settings` from handles, not from codecs.

**README FIX (two).**

1. The README says managed names are `vignette/<show>/<scene>/<layer>`. OBS scene *items* have no
   names; only inputs and scenes do. Items are identified by `(scene, input)` and matched by
   source UUID. Change the README to: scenes `vignette/<show>/<scene>`, inputs
   `vignette/<show>/<source>`; a layer's identity in OBS is its source placed in its scene.
2. Consequence: `<Use source="x">` twice in one scene cannot be represented distinctly. Keep it a
   diagnostic (`DUPLICATE_PLACEMENT`) and say so in the README's Identity section. Inline sources
   never hit this because each layer is its own input.

### 3.10 React client (`vignette/react`, new; replaces `target-dom/react.ts` `useStage`)

**Vision.** `<Stream url|source sources?>`, `<Stage scene>`, `useSnapshot`, `useScene`,
`useAsset` (suspends; TanStack Query by hash), `useCanvas`, `useStreamStatus`. Source plugins are
`{ kind, View }`. Shared sources stay mounted across scene switches.

**Today.** `useStage` + `StageController` (243 lines) wrap `DOMRuntime` in an external store with
its own `StagePhase` union and generation counters. No React rendering of snapshots exists; the
DOM target builds elements imperatively.

**Keep.** Nothing from `target-dom/react.ts`. The `useSyncExternalStore` pattern for status.

**Rip out.** `target-dom/react.ts`, `StageStatus`, `StagePhase`, `StageController`,
`UseStageOptions`, `UseStageResult`, `StageRef`.

**Build.**

- `react/stream.tsx`: `<Stream>` creates one kernel-backed `ReactTarget` (a `createTarget` whose
  `update` sets React state) and provides `{ snapshot, setup, status }` via context. Connection
  is `fromSse(url)` or the given iterable; lifetime is the component's.
- `react/stage.tsx`: `<Stage scene>` renders `snapshot.scenes[scene].items` as absolutely
  positioned `<div>`s using `item.frame`, `placement`, `opacity`, `rotation`, `visible`; a
  scaling wrapper fits the canvas into the container (port `DomStage.scaleToContainer`).
- `react/sources.tsx`: `<SourceView id>` looks up the plugin by kind and renders `View`.
- `react/assets.ts`: `useAsset(name)` → `useSuspenseQuery({ queryKey: ["vignette-asset", hash],
  queryFn: fetch(serve.assets + name) → blob → objectURL })`. Requires a `QueryClientProvider`
  above; `<Stream>` throws a clear error if none.
- **Shared source persistence.** `README FIX` the README says shared sources are "rendered once
  and kept mounted across scene switches". React portals detach and reattach DOM nodes on
  container change, which reloads iframes. Implement as: `<Stream>` renders every *shared*
  source's `View` once into a hidden host; `<Stage>` positions a placeholder and, in an effect,
  calls `host.moveBefore(el, null)` (falling back to `append` where unsupported, which reloads,
  as today's `patch.ts` already accepts). Document the mechanism in one sentence; keep the
  promise.
- `react/plugin.ts`: `ReactSourcePlugin<Def> { kind; View: FC<{ source; item }> }`.
- Built-in Views in `react/sources/*.tsx`: `Color` div, `Image` img via `useAsset`, `Video`
  video via `useAsset` with `loop/muted/restartOnShow`, `Browser` iframe, `Frame` renders the
  frame's component inline with validated params.

### 3.11 DOM target (`vignette/dom`; today `target-dom/*`)

**Vision.** `domTarget(container, { scene, sources?, builtins? })`, imperative plugins with
`load/create/update/dispose`, separate from React.

**Today.** `dom-target.ts` (369), `patch.ts` (346), `source-registry.ts` (133), `stage.ts` (78),
`media-registry.ts`, `styles.ts`, `elements/*`, `runtime.ts`, `asset-store.ts`, `sse.ts`,
`react.ts`.

**Keep.**

- `stage.ts` `DomStage` (viewport + scaled stage, `ResizeObserver`).
- `patch.ts` `applyContentPlacement` and the `moveBefore` guard in `mountRecord`.
- `styles.ts` `px`.

**Rip out.**

- `dom-target.ts` class (kernel replaces its queue/status/waiters), `patch.ts` record management
  and `patchNestedScene`, `source-registry.ts`, `media-registry.ts`, `runtime.ts`,
  `asset-store.ts` (kernel store), `sse.ts`, `react.ts`, `elements/types.ts`
  (`DomSourceRenderer`), `elements/index.ts` `resolveDomRenderers`.

**Build.**

- `dom/target.ts`: `createTarget<DomHandle>` where `update(snapshot, handles)` diffs the chosen
  scene's items against a `Map<layerId, wrapperDiv>` and positions handles' elements. ~150 lines
  given the kernel does lifecycle and assets.
- `dom/plugin.ts`: `DomSourcePlugin<Def> { kind; load?(): Promise<void>; create(source, ctx):
  DomHandle }`, `DomHandle { element; update(source); dispose() }`.
- `dom/sources/*.ts` built-ins.

### 3.12 Frames (`packages/frame/*`, `packages/vite` frame parts)

**Vision.** `frame({ params, view })`. `<Frame of params>` is a source kind. OBS opens a static
`frames.html?frame=&source=&stream=`; the page follows the stream and renders the source's
frame. `mountFrames(frames, …)` in one client bundle. No SSR, no hydration, no server API, no
second channel.

**Today.** `definition.ts` (`frame`, `FrameMetadata`, `withMetadata`), `transform.ts` (TypeScript
AST transform injecting route metadata into exported `frame()` calls), `server.ts`
(`FrameRouteRegistry`, `renderFrameHtml`, `renderHydrationModule`, `resolveFrame`,
`createFrameRequestHandler`), `client.ts` (`hydrateFrame`), `view.ts` (`View` → `BrowserView` with
`/__vignette/frame/<key>?props=` URL), `frame-element.ts`, `serialization.ts` (canonical JSON +
FNV hash), `remote-store*.ts` (typed refs, SSE client hook, server encoder). Vite plugin:
`virtual:vignette/frames`, per-frame client entries, `frame-client.js` helper, `/@fs/` module URL
mapping, `FrameRouteRegistry` generation, dev middleware serving frames via `ssrLoadModule`.

**Keep.**

- `definition.ts` core: `frame({ params, view })` returning `{ params, view }`; the
  parameterless overload. Drop `metadata`, `withMetadata`, `__withMetadata`, `isFrameDefinition`
  (replaced by the `Frame` kind carrying the frame's *name*, see below).
- `serialization.ts` `serializeFrameParams` canonicalisation (params must be JSON; keep the
  check). Drop `hashFrameValue`.

**Rip out.** `transform.ts`, `server.ts`, `client.ts`, `view.ts`, `frame-element.ts`,
`remote-store.ts`, `remote-store-client.ts`, `remote-store-server.ts`, all `./remote-store*`,
`./server`, `./transform` exports; the `typescript` runtime dependency; every `/__vignette/*`
path constant; Vite virtual modules for frames; per-frame rollup inputs; `frame-client.ts`
helper entry; `docs/react-frames.md` (rewrite).

**Build.**

- `core/sources/frame.ts`: `Frame = defineSource({ kind: "frame", props: z.object({ frame:
  z.string(), params: z.json() }), size: (_, { canvas, layer }) => layer ?? canvas })` plus a
  React wrapper `<Frame of={def} params>` that resolves `of` to its *name*. `DECISION` frame
  names: the `frame()` call takes an explicit `name` (`frame({ name: "Scoreboard", params, view
  })`). Deriving from the export identifier needs the AST transform we are deleting. `README
  FIX` add `name` to the frame example; `mountFrames({ Scoreboard })` then maps by
  `def.name`, and a mismatch between key and `name` is a startup error in the page.
- `frame/mount.tsx`: `mountFrames(defs, { root? })` reads `frame`, `source`, `stream` from
  `location.search`, renders `<QueryClientProvider><Stream url={stream}><FrameFromSource
  frame source/></Stream></QueryClientProvider>` with `createRoot`. `FrameFromSource` selects the
  source by ID from the snapshot, validates `params` with `def.params`, renders `def.view`.
  Reuses `vignette/react` wholesale.
- `bundle/frames-html.ts`: the static page template.

### 3.13 Bundle, Vite plugin and CLI (`packages/vite/*`, `packages/cli/*`)

**Vision.** `vignette dev show.tsx [--obs] [--source pkg]`, `vignette build show.tsx`,
`vignette bundle show.tsx --out dir`, `vignette obs <stream-url> [--source pkg]`,
`vignette preview <stream-url> --scene --out`. `bundle()` as a function. A Vite plugin for
frontends already on Vite.

**Today.** `vite/index.ts` (frame discovery via AST, asset discovery + hashing + emitted files,
virtual modules, client input injection, dev middleware for frames and the stream);
`vite/dev-composer.ts` (module runner, coalesced reload, identity-change root replacement, SSE
handler); CLI with `preview` (Playwright + its own static server mapping four package roots) and
`obs` (`--project --obs-url --url --base-url --browser-source-base-url --extension`).

**Keep.**

- `dev-composer.ts` nearly verbatim. It is the hot-reload engine for `vignette dev`. Changes:
  load `default` export (an element or component) instead of `composition`; drop the zod
  `CompositionFieldsSchema`; `sameIdentity` compares `id`, `canvas`, and the manifest version;
  publishes `serve` from the dev server's resolved origin.
- `discoverAssets` hashing logic → `scanAssets`.
- CLI option parser skeleton (`cli-options.ts`), `preview.ts` Playwright flow (screenshot a
  `<Stage>`), `obs-extensions.ts` module loading (rename `--source`, validate against
  `ObsSourcePlugin` shape).

**Rip out.**

- Vite plugin: `transformFrameDefinitions` use, `virtual:vignette/frames`, `clientInputs`,
  `entryFileNames` rewriting, `generateFramesModule`, `resolveFrame` middleware,
  `ComposerRootHook`/`onComposerRoot` (replaced by `--obs` in the CLI calling `obsTarget` against
  `composer.stream()`), `configDefaults.ssr.external` hack (verify whether still needed with one
  package).
- CLI `obs` flags `--project`, `--url`, `--base-url`, `--browser-source-base-url`,
  `--extension`. CLI `preview` flags `--snapshot`, `--base-url`; its four-root static server;
  `browser.ts` `__vignettePreviewRender` global.
- `cli/load-snapshot.ts` file-envelope loading (`SnapshotEnvelopeWireSchema`,
  `requireResolvableUrls`, `manifestUrls`). `DECISION` `preview` takes a stream URL only.

**Build.**

- `bundle/bundle.ts`: `bundle(showPath, { out })`:
  1. `scanAssets(dirname(showPath))` for files referenced by `src` props — `DECISION` discovery is
     by glob over an `assets/` directory next to the show (README's project layout), not by
     static analysis of `src` strings. Writes `out/assets/<name>` and `out/assets.json`.
  2. Frame discovery by glob `**/*.frame.{tsx,jsx}` from the show's directory; generates a
     temporary entry `import * as f0 from "./scoreboard.frame"; … mountFrames({ ...f0, ...f1 })`
     and builds it with `vite build` (library already depends on Vite) to `out/frames.js`.
     Non-frame exports are filtered at runtime by shape.
  3. Writes `out/frames.html` from the template.
- `cli/dev.ts`: Vite dev server with the plugin below, `serve` = dev origin, optional `--obs`.
- `cli/build.ts`: `bundle` + emit `dist/server.js` (a Hono or `node:http` host equivalent to the
  README's Express example).
- `vite/index.ts` (slim): registers the dev composer middleware at `/stream`, serves
  `frames.html`/`frames.js`/assets from an in-memory `bundle` in dev, exposes nothing virtual.
- `README FIX` `compose({ assets })` "omit it and the composer hashes src files at startup"
  requires file-system access in the composer, which rule 4 forbids. Change the README to:
  `assets` is required when the show uses asset-bearing kinds; `scanAssets(dir)` from
  `vignette/bundle` produces it. The `dev` command does this for you.

### 3.14 Assets

**Vision.** Manifest `{ version: hash-of-manifest, entries: [{ name, hash }] }`. Targets fetch
`serve.assets + name`, verify `hash`, cache by hash. `useAsset` in React; `assets.resolve` in
DOM/OBS plugin contexts.

**Today.** Manifest entries carry `url` and optional `integrity`; `version: 1 | sha256-…`;
root-relative URL conventions; two stores.

**Build.** `core/assets.ts`: `AssetManifestSchema`, `AssetEntry { name, hash: "sha256-…" }`;
`target/asset-store.ts` interface (3.8). `assets?: readonly (keyof P)[]` on `defineSource` lets
the composer compute the set of asset names a show needs and diagnose a name missing from the
manifest (`MISSING_ASSET`). `README FIX` add `MISSING_ASSET` to the composer diagnostics list
if the README gains one; otherwise no change.

### 3.15 Events

**Vision.** `composer.emit({ kind, ...})`; targets handle known kinds, plugins opt in with
`event(handle, event)`; built-in `media:restart`.

**Today.** `StreamEvent` is `{ id, kind: "scene:select", sceneId }`; both targets implement
`event()` as scene selection; OBS awaits settlement first.

**Build.** `EventSchema = z.object({ kind: z.string() }).passthrough()`. Kernel: route to the
target's `event?` and to every handle whose plugin has `event` when `event.sourceId` matches, or
to all handles when it does not. Built-in `media:restart { sourceId }` handled by Video plugins
(DOM: `currentTime = 0; play()`; OBS: `TriggerMediaInputAction` `RESTART`). Remove
`scene:select`.

### 3.16 MoQ example package (`packages/moq`)

Rewrite to the four-entry layout in the README: `index.ts` (`defineSource`), `react.tsx`
(`MoqView`), `dom.ts` (`moqDom`), `obs.ts` (`moqObs` native). Delete `moqSourceModule`,
`moqDomRenderer`, `moqObsCodec`, `moqSource()` builder, `MoqSource` component wrapper (the
`defineSource` result *is* the component).

### 3.17 Testkit and tests

**Keep.** `fake-obs-transport.ts`, `fake-obs-state.ts`, `manual-clock.ts`,
`obs-plan-matchers.ts` (adjust to new plan shapes).

**Rip out.** `fake-target.ts` (implements `RenderTarget`; replace with a `createTarget` whose
`update` records calls), `scheduler.test.ts` in testkit (moves to `obs/` as a reducer test).

**Tests that die with their modules** (delete, do not port): `cli/browser.test.ts`,
`cli/load-snapshot.test.ts` (SSE half), `frame/remote-store*.test.*`, `frame/server.test.ts`,
`frame/transform.test.ts`, `frame/definition.test.tsx` (metadata parts), `moq/*.test.ts`
(rewrite), `target-dom/asset-store.test.ts`, `target-dom/react.test.tsx`,
`target-dom/runtime.test.ts`, `target-obs/asset-store.test.ts`, `target-obs/sse.test.ts`,
`target-obs/codecs/*.test.ts`, `vite/index.test.ts`, `react/host-tree.test.ts` (rewrite for
`lowerShow`), `core/validation.test.ts` (rewrite for `validate.ts`).

**Tests to port with intent preserved**: `core/layout/*.test.ts`, `core/sse-codec.test.ts`,
`core/stream.test.ts` (hub), `react/root.test.tsx` + `settled.test.tsx` → `compose.test.tsx`,
`target-dom/dom-target.test.ts` → `dom/target.test.ts` (fewer cases: no nested scenes),
`target-obs/planner.test.ts`, `executor.test.ts`, `operations.test.ts`,
`examples/kitchen-sink/src/server/production.test.ts`, Playwright `dom.spec.ts` and
`obs-integration.spec.ts`.

**New tests** (behavioural, per AGENTS.md): one reducer test file per machine in section 6,
driven by event sequences; `fromSse` round trip with chunk boundaries split mid-record;
`createTarget` asset stage ordering (updates queued until assets verified); plugin lifetime
(create once per ID, update on prop change, dispose on removal, async create → `preparing`);
`defineSource` schema failure → `INVALID_PROPS` with zod path; derived-ID stability cases from
the README's Identity section; `bundle()` output shape; frame page param updates without reload
(Playwright, asserting iframe `contentWindow` identity across revisions).

### 3.18 Examples and docs

- `examples/simple`: `show.tsx` default-exporting `<Show>`; `index.ts` uses `compose(show).once()`.
- `examples/kitchen-sink`: rewrite `show.tsx` to inline sources, `<Use>` for the shared MoQ
  source, `<Frame of={Clock}>`; `app.tsx` to `<Stream><Stage/></Stream>`; server to the README's
  Express/Hono shape; drop `kitchen-sink-obs.ts`, `obs-worker.ts` (use `vignette obs`),
  `vite.ssr.config.ts`.
- `docs/architecture.md`, `docs/compatibility-contract.md`, `docs/obs-safety.md`,
  `docs/deployment.md`, `docs/getting-started.md`: rewrite against the README. Delete
  `docs/dom-stage-hook.md`, `docs/react-frames.md`, `docs/dynamic-compositions-cloudflare.md`
  (fold a short Workers note into deployment). `plans/001–013` stay as history; `plans/README.md`
  gets a note that 014 supersedes the architecture they describe.
- `README.vision.md` becomes `README.md` when the plan is DONE, with the `README FIX` items
  applied.

---

## 4. Deletion inventory

Files to delete outright (not rewrite). Counted from the current tree; line counts are
non-test source.

| File | Lines | Why |
| --- | ---: | --- |
| `core/src/source-module.ts` | 249 | replaced by `defineSource` |
| `core/src/capabilities.ts` | 87 | capabilities model removed |
| `core/src/validation.ts` | 517 | zod schemas + 120-line structural check |
| `core/src/wire-schemas.ts` | 180 | schemas move into the model files |
| `core/src/authoring.ts` | 127 | no intermediate authoring graph |
| `core/src/builders.ts` | 95 | React is the authoring API |
| `core/src/sources.ts` | 69 | built-ins are `defineSource` |
| `core/src/resource-url.ts` | 75 | no URLs in snapshots |
| `core/src/layout/layout-yoga-workerd.ts`, `layout-yoga-wasm.ts` | ~70 | single wasm import entry (pending verification) |
| `react/src/composition.ts` | 43 | `<Show>` replaces it |
| `react/src/presets.ts` | 8 | no layout helpers |
| `react/src/source-element.ts` | 39 | `defineSource` owns components |
| `react/src/status.ts` | 41 | inlined store |
| `react/src/root.ts` | 443 | rewritten as `compose` + machine |
| `target-dom/src/runtime.ts`, `react.ts`, `sse.ts`, `asset-store.ts`, `source-registry.ts`, `media-registry.ts`, `elements/*` | ~690 | kernel + plugins |
| `target-dom/src/dom-target.ts`, `patch.ts` | 715 | rewritten on kernel (~200 lines) |
| `target-obs/src/runtime.ts`, `create-obs-target.ts`, `status-store.ts`, `capabilities.ts`, `asset-store.ts`, `sse.ts`, `wire-schemas.ts`, `codecs/*` | ~600 | kernel + plugins |
| `target-obs/src/scheduler.ts` | 563 | machine 6.3 + ~120-line runner |
| `frame/src/server.ts`, `transform.ts`, `client.ts`, `view.ts`, `frame-element.ts`, `remote-store*.ts` | ~690 | static page + stream |
| `vite/src/index.ts` (most), `virtual.d.ts`, `frame-client.ts` | ~300 | `bundle` + slim plugin |
| `cli/src/browser.ts`, `load-snapshot.ts` | 413 | preview uses `vignette/react` + `fromSse` |
| `moq/src/*` | 241 | rewritten to plugin layout |
| per-package `package.json`, READMEs, tsconfigs | — | one package |

Roughly 6,000 of the current 12,400 lines go, and most of the remainder is the planner,
executor, layout compiler and host config, which are kept nearly as-is.

---

## 5. New file inventory

```
packages/vignette/src/
  core/
    snapshot.ts          zod model + types
    assets.ts            manifest schema
    define-source.ts
    validate.ts          structural diagnostics
    diagnostics.ts       (kept, trimmed codes)
    geometry.ts, layout/{compile,style,yoga-runtime,content-fit,rounding,yoga}.ts
    sources/{color,image,video,browser,frame}.ts
  react-authoring/
    elements.tsx         Show, Scene, Layer, Use
    host-config.ts, host-tree.ts, host-types.ts, reconciler.ts
    lower.ts             host tree → compiler input, derived IDs
  compose/
    compose.ts, machine.ts, status.ts
  stream/
    messages.ts, hub.ts, async-queue.ts, sse.ts
  target/
    kernel.ts, machine.ts, status.ts, asset-store.ts (interface), plugins.ts
  obs/
    target.ts, machine.ts, plugin.ts, planner.ts, executor.ts, operations.ts,
    observed-state.ts, bootstrap.ts, events.ts, naming.ts, errors.ts,
    transport.ts, websocket-transport.ts, asset-store.ts, sources/*.ts
  react/
    stream.tsx, stage.tsx, sources.tsx, assets.ts, hooks.ts, plugin.ts, sources/*.tsx
  dom/
    target.ts, stage.ts, plugin.ts, asset-store.ts, sources/*.ts
  frame/
    definition.ts, mount.tsx, serialization.ts
  bundle/
    bundle.ts, scan-assets.ts, frames-html.ts
  vite/
    plugin.ts, dev-composer.ts
  cli/
    cli.ts, options.ts, dev.ts, build.ts, bundle.ts, obs.ts, preview.ts, load-plugins.ts
```

---

## 6. Explicit state machines

Each machine is a pure function `reduce(state, event): { state, effects: Effect[] }` in its own
file with no I/O imports, plus a runner that executes effects and feeds results back as events.
Tests exercise `reduce` with event sequences and assert on state and emitted effects; the
`manual-clock` and `fake-obs-transport` drive runners in integration tests.

### 6.1 Composer

Today: `compileScheduled`, `compiledRevision`, `disposed`, `compileFailure`, `renderFailures`,
`renderRejectors`, `compileWaiters`, plus the container's `commitRevision`/`commitActive`.

```
state: { phase: idle | compiling | ready | error | disposed
         commitRevision, compiledRevision, snapshot?, diagnostics, error?
         waiters: [{ revision, resolve, reject }] }

events:  committed(rev) | compileStarted(rev) | compiled(rev, snapshot, diagnostics)
       | compileFailed(rev, error, diagnostics) | renderFailed(rev, error)
       | awaitRevision(rev, resolve, reject) | dispose

effects: scheduleCompile(rev) | publish(update, snapshot) | resolve(waiter, snapshot)
       | reject(waiter, error) | report(error) | closeHub
```

Transitions: `committed` in any live phase → `compiling` + `scheduleCompile` (coalesced: ignore
if already scheduled for a newer rev). `compiled(rev)` → `ready`, publish, resolve waiters with
`revision <= rev`. `compileFailed`/`renderFailed(rev)` → `error`, reject waiters with
`revision <= rev`, keep last good snapshot. `awaitRevision` resolves immediately when
`compiledRevision >= rev`, rejects immediately when `error.revision >= rev`, else enqueues.
`dispose` → `disposed`, reject all, `closeHub`.

### 6.2 Target kernel

Today: split across `hasSetup`/`setupFailure` in runtimes, `pending`/`draining`/`scheduled`/
`desiredGeneration`/`settledGeneration` in `DomTarget`, and duplicated in the scheduler.

```
state: { phase: idle | checking-plugins | downloading-assets | ready | error | disposed
         setup?, pendingSnapshot?, applying: boolean, desiredRevision, settledRevision
         assets: { done, total, failed: name[] }
         handles: Map<id, { status: preparing | live | error, handle?, source }>
         waiters }

events:  message(setup|update|event) | pluginsChecked(missing: kind[])
       | assetDone(name) | assetFailed(name, error) | assetsComplete
       | handleCreated(id, handle) | handleFailed(id, error) | handleUpdated(id)
       | applied(rev) | applyFailed(rev, error) | awaitRevision | dispose

effects: checkPlugins(kinds) | ensureAssets(entries) | createHandle(id, source)
       | updateHandle(id, source) | disposeHandle(id) | apply(snapshot, handles)
       | dispatchEvent(event, handles) | resolve/reject waiters | report(error)
```

Transitions: `setup` → `checking-plugins` → (missing ≠ ∅ → `error`, stays until a new setup) →
`downloading-assets` with `ensureAssets`; `update` while not `ready` → store as `pendingSnapshot`
(latest wins). `assetsComplete` → `ready`, then if `pendingSnapshot` → diff handles (emit
`createHandle`/`updateHandle`/`disposeHandle`), `apply`. `applied(rev)` → `settledRevision =
rev`, resolve waiters, and if a newer pending exists, apply again. `handleCreated` while `ready`
→ re-`apply` current snapshot so the medium swaps placeholder for live. A new `setup` mid-flight
→ dispose all handles, evict assets not in new manifest, restart from `checking-plugins`.

### 6.3 OBS connection and convergence

Today: `connected`, `observed`, `draining`, `scheduled`, `paused`, `disposed`, `terminal`,
`epoch`, `retryAttempt`, `notReadyAttempt`, `retryTimer`, `inFlightRevision`, `failedRevision`,
`failedError`, `refreshedSources`, `pending`, `desired`.

This machine sits *inside* the kernel's `apply` effect for the OBS target: the kernel asks for a
snapshot to be applied; this machine owns how.

```
state: { conn: disconnected | connecting | connected
         obs:  unobserved | observing | observed(state, epoch)
         work: idle | planning | executing(epoch) | paused | retry-wait(attempt) | terminal
         desired?: snapshot, retry: { attempt, notReady } }

events:  apply(snapshot) | connected | connectFailed(err) | observed(state) | observeFailed(err)
       | planned(plan | diagnostics) | executed(interrupted?) | executeFailed(err)
       | obsEvent(collectionChanging | collectionChanged | remoteChanged | closed(code))
       | timer | dispose

effects: connect | observe(epoch) | plan(snapshot, observed, handles) | execute(plan, epoch)
       | scheduleTimer(ms) | cancelTimer | disconnect | settled(rev) | failed(rev, err)
       | status(phase, message)
```

Transitions (the ones that matter):

- `apply` → set `desired`; if `conn=disconnected` → `connect`; else if `obs≠observed` →
  `observe`; else `plan`.
- `connected` → `observe(epoch+1)`. `observed` → if `desired` → `plan`.
- `planned(plan)` with no ops → `settled(desired.rev)`; with ops → `execute`.
- `executed(interrupted=false)` → `obs=unobserved`, `observe` (re-read, then re-plan; converges
  when the plan is empty). `interrupted=true` → `observe` (epoch changed).
- `planned(diagnostics)` → `failed(desired.rev, PreflightError)`; stay connected.
- `executeFailed(code 207)` → `retry.notReady++`, `paused`, `scheduleTimer(backoff)` up to max,
  then treat as transport failure.
- `executeFailed(other)` / `connectFailed` / `observeFailed` → `disconnect`, `retry-wait`,
  `scheduleTimer(backoff(attempt))`. `timer` → `connect`.
- `obsEvent(collectionChanging)` → `paused`, `obs=unobserved`. `collectionChanged` → `observe`.
  `remoteChanged` → `obs=unobserved`, if idle → `observe`. `closed(4011)` → `terminal`.
  `closed(other)` → `conn=disconnected`, `retry-wait`.
- `dispose` → `cancelTimer`, `disconnect`, done.

`epoch` is incremented on every `observe` and carried into `execute`; an `executed` event whose
epoch ≠ current is dropped. This replaces `isExecutionValid` closures.

### 6.4 Asset store (inside the kernel's `ensureAssets` effect)

```
state: Map<hash, absent | fetching | verified(location) | failed(error)>
events: ensure(entries) | fetched(hash, bytes) | fetchFailed(hash, err) | verified(hash) | evict(keep)
```

Pure bookkeeping; the only decision is "already verified → skip". Both stores share this and
differ only in `store(bytes) → location` and `release(location)`.

### 6.5 React `<Stream>` connection

```
state: { conn: idle | connecting | open | retry-wait | closed, attempt, lastError? }
events: start(url|iterable) | opened | message(m) | ended | failed(err) | timer | stop
effects: openSse | scheduleTimer | forward(m → kernel)
```

Owned by `fromSse` for URLs (reconnect) and trivial for iterables (no reconnect; `ended` →
`closed`). `useStreamStatus()` reports this plus the kernel's status.

### 6.6 Frame page

`mountFrames` has no machine of its own; it is a `<Stream>` plus a selector. The states a frame
can observe are the kernel's, exposed as `useStreamStatus()`, and the page renders: connecting
→ nothing; source missing from snapshot → nothing; params invalid → error text; otherwise the
view.

---

## 7. Sequencing

Each stage ends with `pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm
format:check` green. Stages 1–3 can be done on a branch where the examples are temporarily
broken; from stage 4 the kitchen sink must run.

1. **Topology.** Collapse packages, turn off `exactOptionalPropertyTypes`, delete
   `omitUndefined`, add directory import rules. No behaviour change. Delete the deletion
   inventory that nothing imports yet (frame remote store, builders, presets).
2. **Model and composer.** New snapshot schema, `defineSource`, built-in definitions,
   `validate.ts`, `lowerShow`, compose machine, `<Show>/<Scene>/<Layer>/<Use>`. `examples/simple`
   runs with `once()`.
3. **Stream and kernel.** `fromSse`, new setup, `createTarget` with machine 6.2, asset stores,
   plugin interfaces. A test target proves lifecycle and asset stage.
4. **DOM target** on the kernel with built-in plugins. Playwright `dom.spec.ts` green against a
   hand-wired page.
5. **OBS target** on the kernel with machine 6.3; planner trimmed; `activeScene`;
   `frame` plugin. `obs-integration.spec.ts` green against local OBS.
6. **React client** (`Stream`, `Stage`, `useAsset`, shared-source persistence) and the kitchen
   sink `app.tsx` on it.
7. **Frames** (`name`, `Frame` kind, `mountFrames`, page template) and **bundle**. Playwright
   test for param updates without iframe reload.
8. **CLI** `dev`, `build`, `bundle`, `obs`, `preview`; slim Vite plugin; dev composer updated.
9. **MoQ** package rewrite; examples and docs; `README.vision.md` → `README.md` with the fixes.

---

## 8. Open decisions (need an answer before the stage that depends on them)

| # | Decision | Needed by | Recommendation |
| - | --- | --- | --- |
| 1 | Derived IDs by sibling index (reordering recreates) vs. something stabler | stage 2 | index; fix the README sentence |
| 2 | Drop nested scenes entirely | stage 2 | drop |
| 3 | Frame `name` explicit in `frame()` | stage 7 | explicit `name` |
| 4 | Yoga single wasm entry feasible for Node + Workers | stage 2 | verify `yoga-layout/load`; fall back to two entries |
| 5 | `preparing` handles: hold the whole snapshot or render placeholders | stage 3 | placeholders |
| 6 | Asset discovery for `bundle`: `assets/` dir glob vs. static analysis of `src` | stage 7 | dir glob |
| 7 | Keep OBS `refreshProperty` press-button flow | stage 5 | drop |
| 8 | `strictMode` composer option | stage 2 | drop |
| 9 | `scene:select` compatibility for operators who want to drive scenes from code without `activeScene` | stage 5 | drop; `activeScene` covers it |
| 10 | State machine library | cleanup | DECIDED (owner, 2026-11-01): use XState v5 for every machine in §6 (composer, kernel, OBS connection+convergence, asset store, stream connection). Maintainability over bundle size. Machines are `setup({ types, actions, guards, actors }).createMachine(...)`; async I/O is `fromPromise`/`fromCallback` actors; the hand-rolled `reduce` + effect-runner pairs and their per-event/per-effect interface declarations are deleted. Tests drive machines with `createActor` + fake actors. OBS becomes one machine with parallel `connection` and `convergence` regions, so `runner.ts` collapses into actor definitions. |
| 12 | Client agnosticism | cleanup | DECIDED (owner, 2026-11-01): clients know nothing about shows, scenes or frames. The React client renders `Frame` sources as iframes to the static frame page (same URL the OBS and DOM targets build), never inline. `<Stream frames>` is deleted. The dev preview page and `vignette preview` import no frame modules. The frame page (`frames.js`) is the only bundle that contains frame components. README updated. |
| 11 | Revision ownership between kernel and OBS | cleanup | DECIDED (owner): the kernel alone owns "revision N is settled". A medium's `update(snapshot, handles)` returns a promise that resolves when the medium has converged; OBS resolves it from its machine's settled state. No deferred-per-revision bookkeeping in the OBS runner, no status wrapper. `TargetStatus` gains `connection?: { phase: "connecting" \| "open" \| "retry-wait" \| "closed"; error? }` filled by OBS (websocket) and by the React client (SSE); `StreamStatus` and the OBS status override are deleted (V5). |

---

## 9. Risks

- **`moveBefore` availability.** Shared-source persistence in both the React client and the DOM
  target depends on `Element.moveBefore`, which is Chromium-only as of writing. Fallback is
  `append`, which reloads iframes. OBS's browser source is Chromium, so the frame page is fine;
  the preview in Safari/Firefox will reload shared browser sources on scene switch. Document it.
- **React in the frame page and in the preview must be the same copy** as the one in `frames.js`?
  No: the frame page is its own document with its own React. Only the *show* and `vignette` must
  share React. The bundle step must not externalise React.
- **`bundle` depends on Vite at runtime** for frame compilation. Acceptable since `vignette/vite`
  already requires it, but it makes `vignette` heavier for pure-OBS installs. Consider making
  `vite` an optional peer that `bundle` imports lazily and errors on clearly.
- **OBS program-scene control.** Setting the program scene from `activeScene` on every
  convergence will fight an operator who switched manually when the show *does* set
  `activeScene`. That is the documented behaviour ("omit to let the operator switch"); make sure
  the planner only emits `set-program-scene` when `activeScene` *changed* since the last settled
  snapshot, not on every re-observe.
- **Scope of deletion vs. the Playwright suites.** The OBS integration test is the only proof that
  the planner still converges a real OBS after trimming. Keep a disposable collection guard and
  run it at stage 5 before touching anything else in `obs/`.

---

## 10. Implementation log and violations

Maintained by the orchestrator during implementation. Each wave lists the agents dispatched and
their ownership. Violations are deviations from `README.vision.md` or from this plan, or code
that does not back the vision (compatibility shims, re-exports of old names, speculative
options). They are fixed by cleanup agents at the end.

### Waves

| Wave | Agent | Owns | Status |
| ---- | ----- | ---- | ------ |
| 1 | foundation | topology, core model, defineSource, built-in definitions, stream messages, target contracts, frame definition, authoring elements | DONE |
| 2A | composer | `compose/`, `react-authoring/lower.ts`, `core/validate.ts`, `core/layout/compile.ts` | DONE |
| 2B | kernel + DOM | `target/`, `stream/sse.ts`, `dom/` | DONE |
| 3A | OBS | `obs/`, `packages/testkit` (deleted → `vignette/obs/testing`) | DONE |
| 3B | React client | `react/` | DONE |
| 3C | bundle | `bundle/` (`bundle()`, `scanAssets`, `frames.html` template) | DONE |
| 4A | frames + dev | `frame/mount.tsx`, `vite/`, `cli/dev.ts`, `cli/build.ts` | DONE |
| 4B | CLI | `cli/` (dispatcher, options, obs, preview, bundle, load-plugins) | DONE |
| 4C | moq + examples + docs | `packages/moq`, `examples/`, `docs/`, `README.vision.md` fixes, `AGENTS.md` | DONE |
| C1 | kernel/compose/stream on XState | `target/`, `compose/`, `stream/`, `core/diagnostics.ts` (one code) | DONE (kernel 1,243 lines, over budget; `sse.ts` grew 188→366) |
| C2 | OBS on XState, settlement via `update` | `obs/`, `packages/moq/src/obs.ts`, kitchen-sink `obs-integration.spec.ts` | DONE (`obs/` 2992 → 2549 non-test lines, over the 2200 target; see C2 notes) |
| C3 | React/DOM/frame client agnosticism, status unification, pages dedupe | `react/`, `dom/`, `frame/`, `vite/pages.ts`, `cli/preview.ts` (page only), `package.json` `exports`, kitchen-sink `app.tsx` + `dom.spec.ts`, `packages/moq` react/dom | RUNNING |
| C4 | packaging, scripts, docs, README finalisation | `package.json` dependency fields, `scripts/`, `bundle/`+`vite/`+`cli/` lazy vite import, `README.vision.md`→`README.md`, `docs/`, `AGENTS.md`, plan status | DONE |

### Violations

Numbering note: Wave 4A's notes refer to its two gaps as "V10" and "V11"; in this table they are V12 and V11 respectively (V10 is the `./cli` export removal).

| # | Found after | Location | Violation | Fix |
| - | ----------- | -------- | --------- | --- |
| R1 | 2A | `README.vision.md` Identity | claims reordering siblings keeps identity; derived IDs are positional | README: reordering needs explicit `id` |
| R2 | 2A | `README.vision.md` §4 compose | says setup is published at construction; it is published before the first update because id/canvas/kinds come from rendering | README wording |
| R3 | 2A | `README.vision.md` §4 options | `layout` described as "a Yoga instance"; it is a `LayoutEngine` from `loadYoga()` | README wording |
| R4 | 2B | `README.vision.md` §7 Events | `media:restart` example addresses `layer`; kernel routes by `sourceId` | README example → `sourceId` |
| R5 | 2B | `README.vision.md` §7 context table | `frames` marked OBS-only; DOM frame plugin needs it too | README table |
| R6 | 2B | `README.vision.md` §5 DOM | `document.querySelector` is `Element \| null` passed as `HTMLElement` | README example |
| R7 | 1 | `README.vision.md` §4 host table | Yoga cannot be one wasm entry for Node and Workers; two entries plus `loadYoga(module)` | README host table |
| V1 | 2B | `src/dom/plugin.ts` `DomHandle.activate?()` | member not in README plugin lifetime (create/update/dispose/event) | FIXED (C3): kept `activate?()` (folding into `update` would make `update` fire without a change and force every DOM plugin, moq included, to branch on it); README §7 DOM plugin gets one line |
| V3 | 2B | `src/target/machine.ts` (709 lines), `kernel.ts` (437) | the kernel reducer is twice the size the plan budgeted; ~240 lines are per-event/per-effect interfaces and dispatch skeleton | FIXED (C1): kernel is an XState v5 machine (`target/kernel-machine.ts`) plus a thin `createTarget` (`kernel.ts`); tokens, generations, the effect queue and waiter bookkeeping are gone (see C1 notes for counts and deleted transitions) |
| R8 | 3C | `README.vision.md` §4 step 2 | says `bundle` follows the show's imports; it globs `**/*.frame.{tsx,jsx}` under the show directory | README wording |
| R9 | 3C | `README.vision.md` §4 Express example | imports `scanAssets` from `vignette`; it lives in `vignette/bundle` (root must stay I/O-free) | README import |
| R10 | 3C | `README.vision.md` §2 Frames | `frame()` example lacks `name` (decision #3) | README example |
| R11 | 3A | `README.vision.md` §6 Status | phase order is `downloading-assets` → `connecting` (assets gate first) | README wording |
| R12 | 3A | `README.vision.md` §7 context table / OBS handle | missing `request(sourceId, type, data)` member and `input.muted`; handle without `update` is re-created on prop change | README table + one sentence |
| R13 | 3B | `README.vision.md` §5 React | `<Stream>` needs `frames={[Scoreboard]}` to render frames inline; `View` plugin typing uses a method signature | README example |
| R14 | 3B | `README.vision.md` Guarantees | "target failures are status, never exceptions in your React tree" — in the React client asset and frame-component errors go to the nearest error boundary; clarify the guarantee is about the show tree | README wording |
| V4 | 3A | `src/obs/runner.ts` (~300 lines), `obs/` total 2992 | runner is mostly promise plumbing between the kernel's `apply` and the machine's `settled`, i.e. two owners of "revision done" | FIXED (C2): `runner.ts` deleted; `obs/machine.ts` is one XState machine with parallel `connection`/`convergence` regions; `obsTarget`'s `update()` sends `apply` and `waitFor`s the machine's `outcome` for that snapshot |
| V5 | 3A+3B | `src/obs/target.ts` status wrapper; `src/react/` `StreamStatus` | two bespoke status shapes layered over `TargetStatus` violates "one status type"; OBS overrides `phase` by wrapping the kernel target, React invents `StreamStatus` | FIXED (C3, React half): `StreamStatus` deleted; `useStreamStatus()` returns `TargetStatus` (`idle` reads `connecting`), `connection` fed from `fromSse` `onConnection` via `CreateTargetOptions.connection`. FIXED (C1): kernel half — `TargetStatus.connection` and `CreateTargetOptions.connection(report)`; `update()`'s promise is the only settlement signal. FIXED (C2): OBS half — the status wrapper (`withConnectionStatus`/`mergeStatus`) is deleted, `obsTarget` returns the kernel's `Target` and reports its websocket through `connection(report)`. Remaining (C3): React `StreamStatus` |
| V6 | 3C | `packages/vignette/package.json` | `vite` and `playwright` are regular dependencies of `vignette`; a pure-OBS install downloads both | FIXED (C4): `vite` is an optional peer (`^8.0.0`) and a devDependency; `bundle`, the Vite plugin's dev composer and `cli/{dev,build,preview}` import it through `bundle/load-vite.ts` (`loadVite()`, error names `pnpm add -D vite`). `playwright` was already an optional peer (4B). Verified: `vignette`, `vignette/obs`, `vignette/bundle`, `vignette/vite` and the CLI dispatcher load with `vite` and `playwright` unresolvable |
| V7 | 3B | `src/stream/sse.ts` | `fromSse` reports no connection state, so the React client cannot show `retry-wait` (machine §6.5) | FIXED (C1): `fromSse(url, { onConnection })` reports `{ phase: connecting \| open \| retry-wait \| closed, attempt, error? }` from a §6.5 XState machine |
| V8 | 3B | `src/react/stage.tsx` inline sources | inline sources remount on every scene show, so an inline video restarts regardless of `restartOnShow` | FIXED (C3): a `<Stage>` following the active scene renders every scene in a `[data-vignette-scene]` box and hides all but the shown one, so inline sources stay mounted for their layer's life; `restartOnShow` counts the layer's scene becoming shown |
| V9 | 3B | `src/react/` plugin check | plugins and frames read at connect time only | FIXED (C3): accepted; README sentence handed to C4 |
| R15 | 4B | `README.vision.md` §3 | `preview` does not render `Frame` sources; `dev --source` only applies together with `--obs` | FIXED (C4): README §3 says `preview` renders frames as iframes like every client; the `dev --source` note stays |
| V10 | 4B | `packages/vignette/package.json` exports | `./cli` subpath removed because `cli/index.ts` is the executable | FIXED (C4): accepted; plan §2 lists the real exports; AGENTS.md says `src/cli` is the bin, not an export |
| R16 | 4A | `README.vision.md` §1, §4 | install needs `react-dom` and `@tanstack/react-query` for dev/build/frames; `dist/` also holds `show.js` and `public/`; bundle served under `/vignette/`; `PUBLIC_ORIGIN` behind a proxy | README wording |
| V11 | 4A | `src/frame/index.ts` exports `mountFrames` | a show importing a frame module loads `react-dom/client` and `@tanstack/react-query` into the Node composer | FIXED (C3): `vignette/frame` exports `frame` and types only; `mountFrames` is `vignette/frame/mount` (new `exports` entry); `bundle`'s generated entry imports it from there |
| V12 | 4A | `src/react/stream.tsx` plugin check vs frame page | the frame page's `<Stream>` errors when the show uses a custom kind with no React plugin, so frames render nothing in OBS for such shows | FIXED (C3, client half): `<Stream checkPlugins>`; `mountFrames` passes `false`. FIXED (C1): kernel half — `CreateTargetOptions.checkPlugins: false` makes an unknown kind a per-source `error` (`no plugin for kind "x"`) instead of a setup failure. Remaining (C3): `mountFrames` and the dev/preview pages set it |
| V13 | 4A | `src/vite/dev-composer.ts` | identity change (id/canvas/manifest) replaces the composer; must become the sole mechanism once V2 makes identity change a compile error | FIXED (C4, verified): `reload` replaces the composer only on `SHOW_IDENTITY_CHANGED` (or a new asset manifest); no snapshot comparison remains. `dev-composer.test.ts` covers an `id` change reaching a connected client as a new setup |
| V14 | 4C | `vignette dev` preview page, `vignette preview` | custom kinds without a React plugin make the page error (`missing source plugin`), so the kitchen sink's preview fails in dev | FIXED (C3, client half): dev and `vignette preview` pages pass `checkPlugins={false}`: unknown kinds render an empty box, source `error`. cleanup: V12's skip-plugin-check path renders nothing for unknown kinds instead of erroring |
| V15 | 4 | whole tree: 12,344 non-test lines vs 12,400 before the refactor | plan §4 budgeted ~6,000 lines; growth is in `target` (1,411), `obs` (2,992), `cli` (1,174), `vite` (681), `react` (1,237) | FIXED (C3, client half): one preview page (`react/preview-page.tsx`) and one HTML template (`vite/pages.ts`) for dev, build and `vignette preview`. cleanup: XState port (V3/V4), status unification (V5), preview/dev page dedupe between `cli/preview.ts`, `vite/pages.ts`, `cli/build.ts` |
| V16 | 4C | `scripts/check-npm-package.mjs` | expects the removed `./cli` export; `publish:check` fails | FIXED (C4): the script expects the current export list (incl. `./obs/testing`, `./frame/mount`), checks `vite`/`playwright` are optional peers and not dependencies, and that every exported file exists after the dry run's build |
| V17 | 4C | README §7 shows `ColorView`/`colorDom`/`colorObs` and `builtins: false` with `[colorObs]` | built-in plugins are not exported from any entry | FIXED (C3, React/DOM half): `ColorView`… from `vignette/react`, `colorDom`… from `vignette/dom`. FIXED (C2): OBS half — `vignette/obs` exports `colorObs`, `imageObs`, `videoObs`, `browserObs`, `frameObs`. Remaining (C3): `vignette/react`, `vignette/dom` |
| V18 | 4C | `src/react/stream.tsx` `frames` prop, `src/react/sources/frame.tsx`, `src/vite/pages.ts` preview entry importing frame modules, kitchen-sink `app.tsx` | the React client bundles the show's frame components; violates decision #12 | FIXED (C3): `<Stream frames>`, `InlineFrame` and inline rendering deleted; React `FrameView` is an iframe to `useFrameUrl(frame, sourceId)`; preview pages import no frame modules; `dom.spec.ts` checks the clock iframe keeps element, document and time origin across a params change and scene switches |
| V19 | C1 | `src/stream/sse.ts` 366 lines (was 188) | the §6.5 connection machine doubled the SSE client; check whether the machine earns its keep over a loop with one `phase` variable reported through `onConnection` | FIXED (C4): the XState machine was ceremony over a loop; `reconnect` is now one loop with `attempt`/`error` and `onConnection` reports; 366 → 271 lines, same transitions, `sse.test.ts` unchanged and green (see C4 notes) |
| V20 | C4 | `src/target/status.ts` `TargetConnection.connection` | accidental recursive member | FIXED (orchestrator): removed |
| V2 | 2A | `compose()` publishes `setup` again when id/canvas/kinds change | README says a show's id and canvas are fixed; re-publishing setup is dev-reload machinery leaking into the library | FIXED (C1): an `id`/`canvas` change after the first compile fails with `SHOW_IDENTITY_CHANGED`; setup is published once and re-published only when a new kind appears (kinds accumulate). Targets handle the re-publish as a new setup (full reset). `vite/dev-composer.ts` replaces its composer on that diagnostic |

### Wave 1 notes

**Yoga entrypoints (decision #4).** A single entry is not viable. `yoga-layout@3.2.1` exports only
`.` (wasm embedded as base64, compiled at import with top-level await) and `./load` (the same
base64 build behind an async function); neither imports a `.wasm` file, so both compile wasm at
runtime, which Cloudflare Workers forbid. Conversely a static `import wasm from "./yoga.wasm"`
yields a `WebAssembly.Module` only under bundlers (Wrangler, Vite plugins); Node's wasm ESM
integration yields instance exports and has no unflagged source-phase import. So there are two
entries: `core/layout/yoga.ts` (`yogaLayoutEngine`, embedded build; the composer must import it
lazily, only when `layout` is omitted, so Workers never evaluate it) and `core/layout/load-yoga.ts`
(`loadYoga(wasm?)`: no argument resolves the embedded engine, a `WebAssembly.Module` instantiates
the vendored glue in `packages/vignette/vendor/yoga`). The `./yoga.wasm` subpath export stays for
Workers (`import wasm from "vignette/yoga.wasm"; compose(show, { layout: await loadYoga(wasm) })`).
`README FIX`: section 4's "Yoga ships as wasm loaded by import; pass `layout: await loadYoga()` if
your host cannot import wasm" is inverted; hosts that cannot *compile* wasm at runtime pass
`loadYoga(module)`.

**Deviations from the plan / Wave 1 brief.**

1. Stream message schemas are `SetupMessageSchema`, `UpdateMessageSchema`, `EventMessageSchema`,
   `StreamMessageSchema` (types `SetupMessage`, `UpdateMessage`, `EventMessage`, `StreamMessage`),
   with the event payload `ShowEventSchema`/`ShowEvent` and `ServeSchema`/`Serve`. The house lint
   rule pairs `EventSchema` with a type named `Event`, which shadows the DOM `Event`; `StreamMessage`
   is also the AGENTS.md vocabulary. SSE ids: setup `"setup"`, update the revision, event
   `event:<kind>`.
2. The snapshot scene schema is `SnapshotSceneSchema`/`SnapshotScene`, not `SceneSchema`/`Scene`:
   the root export already has the `<Scene>` component and TypeScript rejects a value and a type of
   the same name from two modules. `<Layer>` props are `LayerElementProps` because `LayerProps` is
   the `LayerPropsSchema` type (presentation props only, without `id`/`style`).
3. The `source` host element carries `{ definition, props, id }`, not `{ kind, props, id }`. The
   composer needs the kind's schema and `size` to validate and lay out, and nothing is registered,
   so the element must carry the definition; `kind` is `definition.kind`.
4. `defineSource` is generic over the zod object schema, not `ZodType<P>`: components accept
   `z.input` (so `.default()` props are optional) and targets see `z.output`
   (`SourcePropsOf<typeof Moq>`). `SourceDefinitionOf<C>` works for every source component and for
   `Frame`.
5. `ShowTree` inline sources carry `size(layer: Size): Size`, a closure the lowering binds to
   `definition.size(props, { canvas, layer })`; the compiler calls it with the rounded layer frame.
   Shared sources arrive already sized (`layer: undefined`). Inline source IDs must be unique across
   the whole show (sources are show-scoped, layers scene-scoped), so lowering must qualify them,
   e.g. `<scene>.<layer>`. Derived IDs must join segments with `.`: `StableIdSchema` rejects `/`,
   so §3.5's `scene.main/0/1` does not validate.
6. `LayoutStyleSchema` adds `flex` and `top`/`right`/`bottom`/`left` (the README uses them) and drops
   `inset` and `overflow` (clipping is canvas-only, §3.3). `fit` is `cover | contain | stretch`
   (`stretch` replaces `fill`, the default). `align` is `{ horizontal?, vertical? }`, centered by
   default. `crop` is per-edge, non-negative.
7. The compiler (`compileShow`) inherits `visible` and `opacity` (multiplied) from group layers and
   ignores their other presentation props (marked `TODO(wave2)`); `clip` is set only when the
   canvas cuts the frame. `Image` and `Video` sizes default to `size ?? layer ?? canvas`, so
   `contain`/`cover` need an explicit `size` to fit by real proportions.
8. `Target` is not generic: no public member exposes the handle type. The kernel's plugin contract
   is `TargetSourcePlugin<Handle, Context> { kind, load?, create(source, context) }` and handles
   implement optional `TargetHandle { update?, dispose?, event? }`, which the README's DOM and OBS
   handle shapes already satisfy. `CreateTargetOptions` has no `builtins`: each target factory
   (`domTarget`, `obsTarget`) merges its built-ins before calling `createTarget`; it adds
   `assets?: AssetStore`, `fetchAsset?`, `context?(base)` and `dispose?`. `AssetStore.ensure` takes
   the fetcher and a progress listener, because the store cannot know `serve.assets` otherwise.
   `TargetPhase` is the README's phases plus the kernel machine's (`idle`, `checking-plugins`,
   `disposed`); `assets.failed` lists names.
9. `<Frame of params>` validates params with `of.params.parse` during render (the README's
   "validated in the show"); a failure is a render error. Frame definitions are matched
   structurally (`FrameReference`) because `core` may not import `frame`.
10. `INVALID_PROJECT_ID` is renamed `INVALID_SHOW_ID`. `sortDiagnostics` moved into
    `diagnostics.ts`. `HostContainer` no longer carries `projectId`/`canvas`; `<Show>` does.
11. Schemas use zod `.readonly()`, which in zod 4 also freezes parse output. That is within the
    AGENTS.md freezing rule (wire snapshots, authoring inputs) but is runtime freezing.
12. `src/obs` also received `wire-schemas.ts` and `plan.ts`, which the listed files import.
    `ramda`'s `equals` became a local `jsonEquals` in the planner; `Compiled*` type names were
    renamed mechanically; `BrowserSource`/`ColorSource`/`AnySourceDefinition` imports are left
    dangling under `TODO(wave3)`.
13. Tests deleted because their module was deleted (port from `git show HEAD:<path>` when the
    replacement lands): `react/src/root.test.tsx`, `react/src/settled.test.tsx` (→ wave 2
    `compose.test.tsx`), `target-dom/src/dom-target.test.ts`, `frame/src/definition.test.tsx`,
    `core/src/stream.test.ts` (it tested `consumeStream`, not the hub), plus every test §3.17 lists.
    `compile.test.ts` was ported to `ShowTree` input; the "browser viewport must agree" case died
    with the concept.
14. `@strangecyan/vignette-testkit` → `@vignette/testkit` (private), `@strangecyan/vignette-moq` →
    `@vignette/moq` (§2 Keep). Publish scripts are now `scripts/check-npm-package.mjs` and
    `scripts/publish-npm-package.mjs`; `check-docs.mjs` checks `packages/vignette` only.
15. The `vignette/react`, `vignette/dom`, `vignette/bundle`, `vignette/obs`, `vignette/vite` and
    `vignette/cli` entries export nothing yet. `docs/` is untouched.

**Excluded from the gates, and why.**

- `packages/vignette/src/obs/**` (`TODO(wave3)`), `src/vite/**` and `src/cli/**` (`TODO(wave4)`):
  excluded from typecheck/build in `packages/vignette/tsconfig.json` (their `index.ts` stubs are
  still built via `files`) and from lint in `oxlint.config.ts`. Tests: `obs/executor.test.ts` and
  `obs/operations.test.ts` still run and pass; `obs/planner.test.ts` and `cli/**` are excluded in
  `vitest.config.ts`. The OBS boundary lint rule therefore does not run until wave 3 removes the
  ignore.
- `packages/testkit`, `packages/moq`: excluded from root `tsconfig.json` references, root
  `typecheck` (now `pnpm --filter vignette typecheck`), vitest and lint. Their `package.json`
  depends on `vignette: workspace:*`; their sources still import the deleted packages.
- `examples/*`: removed from `pnpm-workspace.yaml` (they depend on deleted workspace packages, so
  `pnpm install` would fail), from root `tsconfig.json`, vitest and lint. Root `build` no longer
  builds the kitchen-sink app; `test:e2e`, `test:obs-integration` and therefore `pnpm ready` and CI
  are broken until the examples are migrated.
- `README.vision.md` is in `.oxfmtrc.json`'s ignore list so the specification is not reformatted.

### Wave 2A notes

**Public API added** (`src/index.ts`): `compose(show: ReactElement | ComponentType, options?:
ComposeOptions): Composer`; `ComposeOptions { assets?, serve?, layout?, onError? }`; `Composer
{ stream(signal?), snapshot, ready(), settled(), once(), emit(event), status, subscribe(listener),
dispose() }`; `ComposerStatus { phase, revision, compiledRevision?, diagnostics, error? }`; and
`ComposerPhase` (the `phase` union, exported because `ComposerStatus` names it). `lowerShow`,
`validateShow` and the machine stay internal.

**Deviations from the plan / Wave 2A brief.**

1. `lowerShow(container)` returns `{ tree?, definitions, diagnostics }`. `tree` is absent when the
   root is not exactly one `<Show>` with a valid ID and canvas. `definitions` maps every kind the
   show renders to its `SourceDefinition`, because `ShowTree` carries only `kind`/`props` and
   validation needs each kind's `assets` list. Hence `validateShow(tree, { definitions, assets,
   serve })` rather than `validate(tree, composeOptions)`.
2. New diagnostic code `INVALID_TREE`: root not one `<Show>`, a layer or `<Use>` directly under
   `<Show>`, a source directly under `<Scene>`, a scene inside a layer, more than one source in a
   layer. Shared sources without `id` are `INVALID_SOURCE_ID`. `validateShow` also reports
   non-URL `serve` values as `INVALID_PROPS` at `serve.<key>` (setup would otherwise fail to decode
   in every target).
3. Inline source IDs: the layer ID verbatim when it is rooted at the scene ID (no explicit `id` on
   the layer or any ancestor, e.g. `main.0.1`); otherwise `<scene>.<layerId>` (`main.guest-ada`,
   `main.sidebar.0`). An explicit `id` on the inline source component wins. Derived layer IDs under
   an explicit layer derive from it (`sidebar.0`). Sibling indices count layers only.
4. Suspense: a hidden layer keeps its index and lowers with `visible: false`; hidden scenes, shared
   sources, inline sources and `<Use>` are absent until revealed.
5. Kinds' `size` functions get `canvas` as `{ width, height }` only. Wave 1's `Color`/`Browser`
   `size` returned the raw canvas, so `source.size` carried `frameRate` in-process but not after
   wire decoding (`SizeSchema` strips it).
6. `compileShow(tree, { revision, layoutEngine })` takes `activeScene` from the tree, not options.
   The revision check and the `MISSING_SOURCE` diagnostic moved out of the compiler (a dangling ref
   now throws, which the per-scene catch turns into `LAYOUT_COMPILE_FAILED`). Group `rotation` is
   ignored (commented); group `fit`/`align`/`crop` have nothing to apply to.
7. Setup is published before the first update, after the first successful compile, and again only
   when `id`, `canvas` or `kinds` change (hot reload). `kinds` = distinct `snapshot.sources[].kind`,
   sorted; shared sources are always in `sources`, so declared-but-unplaced kinds count. No
   manifest → `{ version: "empty", entries: [] }`. Setup is deep-frozen from copies of the host's
   objects.
8. The initial render is synchronous (`updateContainerSync` + `flushSyncWork`), so the first commit
   exists when `compose()` returns and `settled()` needs no render receipt. `settled()` keeps the
   old mechanism (`flushSyncFromReconciler` + `flushSyncWork`, then wait for
   `max(commitRevision, 1)`); default-lane updates (timers, fetches) are not awaited, as before.
9. Machine state adds `scheduled` (coalescing flag) and `compiling` (the revision the runner may
   compile) to §6.1's fields; `failure` is `{ revision, error }`. `compiled(rev)` leaves the phase
   `compiling` when a newer commit is pending. React's uncaught-error callback runs after the
   unmount commit it causes, so `renderFailed(rev)` arrives after `committed(rev)`;
   `compileStarted(rev)` is then skipped so the render error is not replaced by "no `<Show>`".
   Errors caught by an error boundary only go to `onError`; the show still rendered.
10. `ready()` rejects when the first commit fails (it waits for revision 1). `dispose()` is
    synchronous: it disposes the machine first (rejects waiters, closes the hub, notifies
    `disposed`) and then unmounts React so effect cleanups run without the unmount commit being
    compiled. `emit()` after dispose throws.
11. `lower.test.ts` is `lower.test.tsx` (it renders JSX through the reconciler).
12. `examples/simple` is `@vignette/simple-example` depending on `vignette: workspace:*`; it is in
    `pnpm-workspace.yaml`, the root `tsconfig.json` references and root `typecheck`, but still in
    oxlint's `examples/**` ignore. `pnpm install --offline` rewrote `pnpm-lock.yaml` to the current
    workspace (it still listed the deleted packages and examples).

**README conflicts noticed.** §2 Identity still says reordering within a parent keeps identity
(the §3.5 `README FIX` stands). §4 says `compose` publishes setup "once at construction"
(plan §3.6); it cannot, since `id`/`canvas`/`kinds` come from rendering (note 7). §4's options table
calls `layout` "a Yoga instance"; it is a `LayoutEngine` from `loadYoga`. Because `MISSING_SERVE`
and `MISSING_ASSET` are errors, `compose(show).once()` for a show with an `Image`/`Video`/`Frame`
fails without `serve` and a manifest; that matches the README's `serve` row but is worth stating
next to `once()`.

### Wave 2B notes

**Wave 1 contract changes (minimal).**

1. `PluginContextBase` gained `frames(frame, sourceId) => string`, built by the kernel from
   `setup.serve` (`serve.frames?frame=…&source=…&stream=serve.stream`; throws `MISSING_SERVE` when
   either location is absent, which makes that source `error`). The DOM `frame` plugin needs it, so
   README §7's context table is wrong to mark `frames` OBS-only. `obsTarget` overrides it in its
   `context(base)` for the local `frames` option.
2. `target/plugins.ts` gained `TypedSource<Props>` and `SourceOf<Def>` (props typed by a kind's
   schema output) so `DomSourcePlugin<typeof Moq>` / `ObsSourcePlugin<typeof Moq>` type `source`.
3. `target/asset-store.ts` gained `createAssetStore(locations)` (machine §6.4 bookkeeping, sha256
   verification) and `verifyAssetHash`; concrete stores supply `store(entry, bytes)` and
   `release(location)`. The `AssetStore` interface is unchanged. It is closure bookkeeping, not a
   `reduce` function: the only decision is "stored or in flight → skip".

**Deviations.**

1. Hash format: `sha256-<base64>` (Subresource Integrity), matching the old Vite manifest
   producer. `bundle`/`scanAssets` (2A / wave 4) must emit the same.
2. Waiters live in the machine as `{ id, revision }`; the runner keeps the promise callbacks by
   id. `settled()` with nothing desired waits for the first applied revision rather than resolving
   at once. Waiters are rejected when the target enters `error` (missing plugin, asset failure,
   stream failure) or is disposed, and when an apply of a revision `>=` theirs fails.
3. Error kinds: setup-stage failures and stream failure put the machine in `error` until a new
   setup. A failed `update(snapshot)` keeps the machine `ready` with `error` set (status phase
   `error`); the next successful apply clears it.
4. Effects run one at a time in order (handle `update`/`dispose`, then the medium's `update`), so a
   medium never sees a handle mid-update. `create` and `ensureAssets` run detached and report back
   as events tagged with a create token / setup generation; results from a superseded setup or a
   removed source are dropped, and late handles are disposed.
5. A failed `update` on a live handle disposes it and marks the source `error`; a later props
   change for an `error` source re-runs `create`.
6. A new setup resets `revision.desired/settled` to undefined (it is a new stream).
7. `DomHandle` gained `activate?()`: called when the element enters the shown scene. Video uses it
   for `restartOnShow`. Event routing for `media:restart` uses `event.sourceId` (plan §3.15);
   README §7's example `{ kind: "media:restart", layer: "intro" }` should say `sourceId`.
8. `domTarget(container, { scene? })`: `scene` is optional and falls back to
   `snapshot.activeScene`, then the first scene, so a page can follow the show's scene switching.
   A named scene missing from the snapshot is an apply error.
9. DOM placement now scales by transform: each element keeps `source.size` as its CSS size (so an
   iframe lays out at its viewport) and `scale()` fits it into the destination.
10. DOM scene switches adopt a gone layer's wrapper when the new layer places the same source, so
    the element does not move at all (no reload even without `moveBefore`). Elements the shown
    scene does not place wait in a hidden `[data-vignette-parking]` container.
11. Not implemented in the DOM: `Browser.shutdownWhenHidden` (not in the README). Video and image
    plugins are not covered by tests because jsdom has no `URL.createObjectURL`.
12. `fromSse` URL mode retries transport errors and non-2xx responses forever (500 ms doubling to
    10 s, reset after a connection that delivered a message) but throws on an undecodable record
    (JSON or schema error), since a reconnect would replay it. Status of the connection itself
    (§6.5) is not exposed; `<Stream>` (wave on React) will need an `onError`/state hook.

### Wave 3C notes

**Public API** (`vignette/bundle`, Node-only; nothing added to the root `vignette` entry):
`bundle(showPath: string, options: BundleOptions): Promise<BundleResult>` with `BundleOptions
{ out }` and `BundleResult { manifest: AssetManifest; frames: readonly string[] }`;
`scanAssets(dir: string): Promise<AssetManifest>`; `framesHtml({ script }: FramesHtmlOptions):
string`. `vignette/frame` gained a placeholder `mountFrames(frames: FrameExports, options?:
MountFramesOptions)` in `frame/mount.tsx` that throws `TODO(wave4)`; wave 4 replaces the body.

**Deviations from the plan / Wave 3C brief.**

1. The frames entry is a Vite virtual module (`\0vignette-frames-entry`, served by an inline
   plugin), not a temporary file. Nothing is written into the show's source tree, and bare
   imports in it (`vignette/frame`) resolve from the Vite `root` (the show's directory) exactly as
   a file there would. Its text, for frames `a.frame.tsx` and `b.frame.tsx`:
   ```js
   import * as f0 from "/abs/show/a.frame.tsx";
   import * as f1 from "/abs/show/b.frame.tsx";
   import { mountFrames } from "vignette/frame";
   mountFrames({ ...f0, ...f1 });
   ```
2. Vite runs with `configFile: false`, `envDir: false`, `publicDir: false`, root = the show's
   directory, `codeSplitting: false`, `modulePreload: false` and `assetsInlineLimit:
   MAX_SAFE_INTEGER` so `frames.js` is one file and a frame's imported images/fonts never land in
   `out/assets/` (which belongs to the show's manifest). CSS imported by a frame is not handled:
   Vite would emit a separate `.css` that `frames.html` does not load. Wave 4 decides (inject from
   JS, or a `<link>` in the page).
3. `vite` and `tinyglobby` are regular dependencies of `vignette` (vite moved out of optional
   peer + dev deps). `bundle` imports `vite` lazily, only when there are frames. Risk §9 stands:
   pure-OBS installs now download Vite.
4. A show with no frames writes no `frames.html`/`frames.js` (and removes stale ones);
   `out/assets/` is replaced on every run so removed assets do not linger. Without an `assets/`
   directory the manifest has no entries and `version` is the hash of the empty line list (not the
   composer's `"empty"`). `version` = `sha256-<base64>` of `name:hash` lines joined with `\n`,
   names sorted by code unit. `scanAssets` skips dotfiles (tinyglobby default).
5. `frames` in the result are POSIX paths relative to the show's directory, not frame names
   (names are only known by running the modules). Frame discovery ignores `**/node_modules/**`,
   `**/dist/**`, `**/out/**` and the `out` directory itself.
6. `framesHtml` page: doctype, UTF-8, transparent margin-less body, `<div id="frame">`, one module
   script. `mountFrames` should default `root` to `#frame`.
7. `bundle.test.ts` resolves `vignette/frame` through a symlinked `node_modules/vignette` →
   `packages/vignette`, i.e. from `dist`; it needs `pnpm build` first (the gate order does this).

**README conflicts.** §4's Express example and the options table say `scanAssets` comes from
`vignette`; it is exported only from `vignette/bundle` (rule 4, core is I/O-free) — the §3.13
`README FIX` stands. README §4 says `bundle` "follows the show's imports to find every `frame()`
it uses"; it globs `**/*.frame.{tsx,jsx}` next to the show (decision #6 analogue for frames), so
frames outside the show's directory or not named `*.frame.tsx` are not bundled. README §2's frame
example still lacks `name` (decision #3).

### Wave 3B notes

**Public API** (`vignette/react`): `Stream(props: StreamProps)` with `StreamProps { url?, source?,
sources?: readonly ReactSourcePlugin[], builtins?: boolean, frames?: readonly InlineFrame[],
children? }`; `Stage(props: StageProps)` with `StageProps { scene?, className?, style? }`;
`useSnapshot(): Snapshot | undefined`, `useScene(id?): SnapshotScene | undefined`,
`useCanvas(): Canvas | undefined`, `useSetup(): SetupMessage | undefined`,
`useStreamStatus(): StreamStatus`, `useStreamEvents(handler: (event: ShowEvent) => void)`,
`useAsset(name): string`; types `ReactSourcePlugin<Def> { kind; View }`,
`ReactSourceViewProps<Def> { source: SourceOf<Def>; item: Item }`, `StreamStatus`,
`StreamConnection`, `StreamEventListener`; `fromSse` re-exported. `@tanstack/react-query` is an
optional peer of `vignette` (and a devDependency); `react-dom` was already an optional peer.

**Deviations.**

1. `<Stream frames>` (not in the README): the snapshot carries `{ frame, params }`, so rendering
   a frame inline needs its definition in the page. It takes an array of `frame()` definitions,
   matched by `name` (the brief said `Record<string, FrameDefinition>`; an array cannot disagree
   with `definition.name`). Typed structurally as `InlineFrame { name; params.parse; view }` because
   `FrameDefinition<P>` is invariant in `P`. An unknown frame or params its schema rejects render
   nothing and mark the source `error` (the kernel plugin behind the built-in frame view checks on
   create/update). README §5/§7 should show `<Stream url frames={[Scoreboard]}>`.
2. No asset store: the React target's kernel is created without `assets`, which makes the machine
   skip `downloading-assets` (no pass-through store needed). `useAsset` downloads through
   `useSuspenseQuery(["vignette", "asset", hash])`, verifies with `verifyAssetHash`, and returns an
   object URL; `staleTime: Infinity`, `gcTime` 30 min, retried twice except for wrong bytes or a
   name missing from the manifest. Object URLs are revoked on the query cache's `removed` event.
   Before setup arrives `useAsset` suspends on the first setup. `status.assets` is therefore always
   undefined in React; asset progress is Suspense.
3. `StreamStatus` is not `TargetStatus`: README §5 renders `r{revision}`, so `revision` is the
   settled number, plus `desiredRevision`, `connection`, `assets`, `sources`, `error`. `phase` is
   the kernel phase, except `connecting` (or `disconnected` if the stream ended) before the first
   message.
4. Connection (§6.5) is `connecting | open | closed`, inferred from messages and the iterable
   ending or throwing. `retry-wait` is not observable: `fromSse(url)` retries internally and
   reports nothing. It needs an `onConnection` hook in `stream/sse.ts` (Wave 2B note 12); not
   added because `stream/` was out of scope.
5. Shared sources (README FIX, one sentence for the README): "A source placed in more than one
   scene is rendered once by `<Stream>` into its own element, which each `<Stage>` moves into the
   box that shows it with `moveBefore` (falling back to `append`, which reloads iframes outside
   Chromium) and back to a hidden host when no stage shows it." Claims use layout effects so the
   element leaves a box before React removes it; the newest of several boxes wins. Inline sources
   render inside their item box and remount when their scene is shown again, so an inline video
   restarts on every show regardless of `restartOnShow`; shared videos restart only on entering a
   shown stage, as in the DOM target.
6. Plugins and frames are read when the stream connects (the kernel's plugin check); rendering
   uses the latest props. Changing `url` or `source` reconnects with a new kernel target, so under
   StrictMode a `source` iterable is iterated twice (fine for `fromSse` and `composer.stream()`).
7. `ReactSourcePlugin.View` is typed through a method signature so `ReactSourcePlugin<typeof Moq>`
   is assignable to `ReactSourcePlugin` (the README's `FC` property would be contravariant).
8. Built-in views (`ColorView`, …) are not exported; README §7 shows `ColorView` as a
   `vignette/react` export, matching neither this wave's brief nor `vignette/dom` (which does not
   export `colorDom`). Decide at cleanup.
9. Asset or frame-view errors thrown inside the React tree reach the nearest error boundary,
   which conflicts with the README guarantee "Target failures are status, never exceptions in
   your React tree"; the asset error-boundary behaviour was specified by this wave's brief.

### Wave 3A notes

**Public API** (`vignette/obs`): `obsTarget(options?: ObsTargetOptions): Target`;
`ObsTargetOptions { url?, password?, assets?: { fetch?: AssetFetcher, dir? }, frames?(frame,
sourceId), sources?: ObsSourcePlugin[], builtins?, retry?: { initialDelayMs?, maximumDelayMs?,
jitterRatio?, maximumNotReadyAttempts? }, transport?: ObsTransport, clock?: { schedule(ms, cb):
cancel; random() } }`; `ObsSourcePlugin<Def> { kind; load?(); create(source, ctx) }`;
`ObsHandle<Def> { input: { kind; settings; muted? }; update?; dispose?; event? }`;
`ObsPluginContext = PluginContextBase & { inputKinds; port(); request(sourceId, requestType,
data?) }`; type `ObsTransport`; `fromSse`. `vignette/obs/testing` (new package export):
`FakeObs` (stateful in-memory OBS behind `ObsTransport`) and `ManualClock`. Planner, executor,
operations and machine stay internal.

**Deviations.**

1. `packages/testkit` is deleted. Its fakes are replaced by `src/obs/testing.ts`; the request-queue
   `FakeObsTransport`, `applyFakeObsPlan`, `obs-plan-matchers` and `fake-target` are not ported
   (`FakeObs` executes real plans; nothing else used them). Root tsconfig/vitest/oxlint no longer
   mention testkit. `AGENTS.md` (lines 46–47), `README.md` and `docs/*` still describe testkit.
2. `TargetStatus` is unchanged. `obsTarget` wraps the kernel's `Target` and merges the machine's
   phase into status while the kernel is `synchronising`/`settled`: `connecting`, `disconnected`
   (with the last connection error), `error` (session invalidated, 4011) and `synchronising`
   (re-converging after a change made in OBS). The machine derives this status
   (`obsMachineStatus`) instead of emitting a `status(phase, message)` effect.
3. The kernel's `update` resolves only when OBS settles, and the kernel runs effects one at a
   time, so while OBS is unreachable later revisions, handle results and events (e.g.
   `media:restart`) queue behind the apply in flight. `dispose()` releases the runner first,
   which rejects that apply, then disposes the kernel; otherwise dispose would hang.
4. Connection is lazy: the first apply connects. Missing plugins therefore fail before any OBS
   call, but the phase order is `downloading-assets` → `connecting` → `synchronising` →
   `settled`, not README §6's `connecting` first.
5. Foreign show: there is no `show` option, so the machine binds to the first snapshot's show ID;
   a later snapshot for another show fails its apply (`… refusing to touch OBS`) with no request
   sent. The planner also refuses an observation for a different show.
6. Plugin `create` waits until OBS was observed once, so `ctx.inputKinds` is real; sources stay
   `preparing` while OBS is unreachable. A handle without `update` is re-created on a props change
   (`create` again, old handle disposed), which makes README §7's three-line native plugin
   correct. The planner leaves the input and items of a source without a live handle
   (`preparing`/`error`) untouched rather than pruning them.
7. `media:restart` uses a new context member `request(sourceId, requestType, data?)`, which fills
   in the managed `inputName` (so a plugin can only address its own namespace). `Video.muted`
   uses a new optional `ObsHandle.input.muted`, observed with `GetInputMute` (batched with
   `GetInputSettings`; inputs without audio report none) and converged by a `set-input-mute`
   operation in the settings phase.
8. `plan.ts` is deleted without adopting core `Diagnostic` (its code union is closed and
   composer-side): `planObsUpdate` returns `{ ok: true, plan } | { ok: false, problems: string[]
   }`; problems become one `ObsPreflightError`. The opacity warning is dropped (OBS items have no
   opacity). `REQUIRED_OBS_REQUESTS` moved to `bootstrap.ts`; the bootstrap reports missing ones
   as `observed.missingRequests` and the planner turns them into problems. List changes: dropped
   `PressInputPropertiesButton`; added `GetCurrentProgramScene`, `SetCurrentProgramScene`,
   `GetInputMute`, `SetInputMute`.
9. Planner input is `{ desired, observed, handles, settledActiveScene? }` (the brief's
   `programScene`, renamed for what it is); `observed.programSceneName` comes from
   `GetCurrentProgramScene`. `set-program-scene` runs in a new `program` phase after `enable`.
10. Naming: registry `vignette/<show>`, scenes `vignette/<show>/<scene>`, inputs
    `vignette/<show>/<source>`. OBS scenes and inputs share one name space, so a scene and a
    source with the same ID is a planning problem. `parseManagedName(name, show)` no longer
    encodes the kind; the list a name came from does.
11. Inputs exist for every snapshot source with a live handle, including declared-but-unplaced
    shared sources (one live instance, kept in the registry). An input whose kind differs from
    the plugin's is a problem, not replaced, so operator filters are not lost.
12. `set-order` is emitted only when the relative order of the show's items is wrong, and then
    for every item from the bottom up. Absolute indices never converged with operator items or
    `preparing` sources in a managed scene (the plan never became empty).
13. Executor guard is a single `isValid()` (machine still `executing` the same epoch); the old
    "skip destructive phases for a non-current revision" guard is gone because the kernel
    serialises applies.
14. `obsTarget` `url` is optional (default `ws://127.0.0.1:4455`): README §4's Express example
    passes `process.env.OBS_URL`. `runner.ts` is ~300 formatted lines, not ~120 (types, docs).
15. No kernel or stream change was needed.

**README conflicts.** §6 phase order (note 4); §6 "different show ID" needs "than the one this
target already manages" (note 5); §7 context table lacks `request`, and the OBS handle shape lacks
`muted` (note 7); §2 managed names (plan §3.9 README FIX 1 stands) and the scene/source ID
collision (note 10); §7 should say a handle without `update` is re-created on props change.

### Wave 4B notes

**Commands** (`vignette`, bin → `dist/cli/index.js`): `dev <show> [--port] [--host] [--obs]
[--obs-url] [--password] [--source <module>]…`; `build <show> [--out dist]`; `bundle <show> --out
<dir>`; `obs <stream-url> [--obs-url] [--password] [--source <module>]… [--assets-dir <dir>]`;
`preview <stream-url> [--scene <id>] [--out <png|dir>] [--all-scenes] [--timeout <ms>]`; `--help`
/ `-h` per command and at the top level. Stream URLs must be absolute http(s).

**Exports** (all internal to `src/cli`): `parseCommandLine(argv): CliCommand` (closed union, one
member per command plus `help`); `runCli(argv, signal)`; `runObs({ stream, obsUrl?, password?,
sources, assetsDir?, signal, transport? })`; `loadPlugins(specifiers: string[], cwd: string):
Promise<readonly ObsSourcePlugin[]>`; `runBundle(show, out)`; `runPreview({ stream, scene?, out?,
allScenes, timeoutMs })`.

**Deviations.**

1. The `./cli` subpath export is removed from `package.json`. `cli/index.ts` is the executable
   (shebang, signal handlers, top-level `await`), so importing it would run the CLI; the README's
   subpath table never listed `vignette/cli`. Plan §2's subpath list is wrong on this point.
2. `dev`'s `--obs-url`, `--password` and `--source` are errors without `--obs` rather than
   implying it.
3. Signals: for `dev` and `obs` the first SIGINT/SIGTERM aborts the command (which disposes the
   dev server / OBS target); a second exits 130. One-shot commands (`build`, `bundle`, `preview`)
   exit 130 on the first signal.
4. `preview` uses no local HTTP server: Playwright intercepts `<stream origin>/__vignette-preview/`
   (`page.route`) and serves the page and its script there, so the page is same-origin with the
   stream and its assets and needs no CORS. The script is a Vite build (virtual entry, root = the
   installed `vignette` package directory) of `react-dom/client`, `@tanstack/react-query` and the
   built `dist/react/index.js`, so it resolves from an installed package. Readiness: an effect
   inside `<Stream>` marks the page when `useStreamStatus().phase === "settled"` and
   `useIsFetching() === 0` (asset queries), then Node waits for child frames' `load`, fonts,
   `img.decode()`, videos' `readyState >= 2` and two animation frames. One navigation per scene.
   Default scene: `activeScene`, then the first. Default output `<show>-<scene>.png` in the
   working directory (or in `--out` with `--all-scenes`); default timeout 30 s (it includes the
   Vite build).
5. `preview` limitation: `Frame` sources render nothing, because the page has no frame
   definitions (`<Stream frames>`, Wave 3B note 1). README §3 should say so, or a later wave can
   render frames from `serve.frames` in an iframe.
6. `playwright` moved from `dependencies` to an optional peer (`^1.50.0`) plus a devDependency;
   `preview` imports it lazily and prints an install hint when missing. `vite` is still a regular
   dependency (V6 stands for `vite`); `preview` imports it lazily.
7. `loadPlugins` collects exports whose value has a string `kind` and a function `create`
   (directly or inside an exported array, deduplicated); order follows the module namespace, which
   is not guaranteed across loaders. Bare specifiers resolve with `createRequire` from `cwd`
   (CJS conditions), falling back to Node's own resolution from the CLI.
8. `obs` prints one stderr line per distinct status (`obs: <phase>`, plus `n/total assets` while
   downloading, `rN` when settled, and the error message).
9. `src/cli/dev.ts` and `src/cli/build.ts` were created as `TODO(wave4A)` stubs with 4A's exact
   signatures because 4A had not created them; 4A overwrites them.

**Gates.** `src/cli` is no longer excluded from tsconfig, oxlint or vitest. CLI typecheck, lint,
format and its three test files pass. At the time of writing the full gates fail only in files
owned by 4A/4C: `src/vite/*` (TS6307: the tsconfig still excludes `src/vite/**` while new files are
imported from `src/vite/index.ts`; 4A must drop that exclusion), `src/frame/mount.tsx` (lint,
format), `examples/kitchen-sink` production test, `packages/moq` and `examples/simple` lint/format.

### Wave 4A notes

**Public API.** `vignette/frame`: `mountFrames(frames: FrameExports, options?: MountFramesOptions):
() => void` with `MountFramesOptions { root?: HTMLElement; queryClient?: QueryClient }` (returns
an unmount function). `vignette/vite`: `vignette(options: VignetteOptions): VignettePlugin` with
`VignetteOptions { show: string; streamPath?: string }`, `VignettePlugin extends
Plugin<VignettePluginApi> { api: VignettePluginApi }`, `VignettePluginApi { composer(): Composer |
undefined; onComposer(listener: ComposerListener): () => void }`. `src/cli/dev.ts`:
`runDev(options: RunDevOptions): Promise<DevServer>` (`RunDevOptions { show; port?; host?; obs?:
RunDevObsOptions { url?; password?; sources?: string[] } }`, `DevServer { origin; close() }`).
`src/cli/build.ts`: `runBuild(options: RunBuildOptions { show; out }): Promise<void>`.
`src/bundle/bundle.ts` additionally exports `discoverFrames(root, out)` and `generateFrameEntry(
frames)` (internal; not re-exported from `vignette/bundle`).

**Deviations.**

1. Dev composer keeps one composer per show identity. `compose()` has no `render(element)`, so
   the composer's root is a `DevShow` component reading the latest default export from an
   external store (`useSyncExternalStore`). A reload hands it the new export, waits for
   `settled()`, and compares the snapshot's `id`/canvas before and after; revisions keep counting
   on open connections. A changed `id`/canvas or a changed asset manifest (rescanned only after a
   change under `assets/`) replaces the composer, which aborts its SSE responses so clients
   reconnect. When V2's cleanup turns an identity change into a compile error, `reload` must also
   replace on that diagnostic.
2. Vite invalidates its SSR transform cache only after awaiting plugin `watchChange` hooks, so the
   watcher handler raced it and re-imported stale code. `fileChanged` now calls
   `server.environments.ssr.moduleGraph.onFileChange(file)` first.
3. No SSR externals are configured. Verified: with `vignette` linked (symlinked, so Vite inlines it
   in SSR) a show using `useState` composes, because React itself is in `node_modules` and
   externalised, so the composer and the show share it. Plugin defaults are only
   `optimizeDeps.exclude: ["yoga-layout"]` and `resolve.dedupe: ["react", "react-dom"]`.
4. `serve` origin: `server.origin` if set (the knob for remote OBS in dev), else
   `http(s)://<host>:<port>` once the HTTP server listens, with `localhost` for an unset or
   wildcard host. Middleware mode without `server.origin` throws in `configureServer`.
5. Preview page: `/` (served by `runDev`, not the plugin) loads `/vignette/preview.js`, a virtual
   module the plugin serves. It imports every frame module (so `<Stream frames>` renders frames
   inline), React, `react-dom/client`, `@tanstack/react-query` and `vignette/react` as bare
   imports from the show's directory, and honours `?scene=`. A show project therefore needs
   `react-dom` and `@tanstack/react-query` installed for `vignette dev`/`build` (they are already
   needed for frames and `vignette/react`).
6. `frames.html` in dev goes through `transformIndexHtml`, so the frame page full-reloads on frame
   edits. Adding or removing a `*.frame.tsx` invalidates both virtual entries and full-reloads.
   Frame CSS (3C note 2) is still unresolved for `bundle`; in dev Vite injects it.
7. `runBuild` = `bundle(show, { out: out/public })` + a Vite client build of the preview entry to
   `public/preview.js` (+ `public/preview.html`) + a Vite SSR build of the show to `out/show.js`
   with `ssr.external: true` (every bare import stays an import, so `out` must live inside the
   project) + `out/server.js` on `node:http`. The server reads `public/assets.json` with
   `readFile` (no JSON import attributes), defaults `PUBLIC_ORIGIN` to
   `http://127.0.0.1:<PORT>` (PORT default 4173), listens on `HOST` or all interfaces, and exits
   cleanly on SIGINT/SIGTERM.
8. `mountFrames` renders a visible `role="alert"` error for a missing query parameter and for a
   `?frame=` the bundle lacks, besides invalid params. Key/name mismatch (plan §3.12) is not
   checked: exports are filtered by shape and names come from the definitions, per the 4A brief.
   The frame fills its root's containing block (`position: absolute`, 100% width/height) because
   `frames.html`'s `#frame` has no height.

**Known gaps for cleanup.**

- V10: the frame page uses `<Stream>`, whose kernel checks every setup kind against the React
  plugins. A show that uses a custom kind with no React plugin puts the frame page's stream in
  `error` before any snapshot, so every frame in that show renders nothing in OBS. Fix in the
  React client (let a consumer skip the plugin check), or give `mountFrames` a pass-through
  plugin per unknown kind.
- V11: a show that imports a frame module pulls `vignette/frame` into Node, which imports
  `mount.tsx` and therefore `react-dom/client` and `@tanstack/react-query` at composer startup.
  Consider moving `mountFrames` to its own subpath or importing them lazily.
- `runDev` logs every OBS phase change; while OBS is unreachable that is two lines per retry.

**README conflicts.** §1 "`pnpm add vignette react`" is not enough for `dev`, `build` or frames:
`react-dom` and `@tanstack/react-query` are needed (note 5). §4 "With the CLI": `dist/` also
holds `show.js` and `public/` (bundle output plus the preview page); `server.js` serves the bundle
under `/vignette/`, and needs `PUBLIC_ORIGIN` behind a proxy.

### Wave 4C notes

**`@vignette/moq`** (`packages/moq`): `Moq = defineSource({ kind: "moq", props: { url, broadcast,
size, latencyMs = 100, video = true, audio = true, quality = "auto", disableWhenHidden = true },
size: props.size })` from `.`; `MoqView` from `./react` (registers `@moq/watch/element` on first
render through `use()`, renders `<moq-watch>`); `moqDom` from `./dom` (`load` registers the element;
create/update/dispose); `moqObs` from `./obs` (native `moq_source`; throws a clear reason when
`ctx.inputKinds` lacks it, so only that source is `error`). The attribute mapping is shared by the
React and DOM plugins in the internal `src/watch.ts`. `vignette` is a peer (and a workspace
devDependency); `zod` and `@moq/watch` are dependencies. Three test files: `index.test.tsx`
(`compose().once()` snapshot with defaults; `INVALID_PROPS` at five paths), `dom.test.ts`,
`obs.test.ts`. The disable-when-hidden *retention* flag of the old DOM renderer has no equivalent
in the new plugin interface and is dropped; the prop still maps to `<moq-watch visible>`.

**Kitchen sink** (`@vignette/kitchen-sink`). `src/show.tsx` default-exports `<KitchenSink />`:
inline `Color`/`Image`/`Frame` sources, shared `<Moq id="demo">` placed with `<Use>` in `main` and
`focus`, `<Frame of={Clock}>`/`<Frame of={Label}>`, and a 2 s timer that highlights cards and flips
`activeScene` every third tick. `src/assets/logo.png` (generated) exercises the asset path. Server:
`src/server/entry.ts` (Hono; README §4 steps; optional `obsTarget` when `OBS_URL` is set). Build:
`tsc -b` → `scripts/bundle.mjs` (`bundle()` → `public/vignette`, gitignored) → `vite build` →
`dist/client`; root `build` runs `build:app` after `tsc -b` again. Deviations:

1. The server reads `public/vignette/assets.json` at startup with `AssetManifestSchema.parse`
   instead of the README's JSON import, so `tsc`/typecheck do not depend on a bundle having run.
2. Playwright's `webServer` only starts the built server (`pnpm build` first, as `pnpm ready`
   does); building inside `webServer` duplicated the root build.
3. `tests/parity.ts` and the DOM↔OBS pixel parity test are deleted; the OBS spec now checks the
   frame input's URL (`frames.html?frame=Clock&source=main.clock&stream=…`) and size instead. The
   CLI `preview` e2e test is dropped (4B owns `preview`).
4. `compose.yaml`'s OBS container runs `vignette obs` with host networking, because locations now
   come from the stream (`PUBLIC_ORIGIN`) and there is no per-target base-URL option in the CLI.
5. `tests/tsconfig.json` typechecks the Playwright specs (they are outside `src`'s `rootDir`).
6. `oxlint-base.json` exempts `**/show.tsx` from `import/no-default-export` (a show file
   default-exports its `<Show>`); the override does not take effect from `oxlint.config.ts`.

**README.vision.md changes.**

- R1: Identity no longer claims reordering keeps identity; lists include "reordered".
- R2: `stream()` row says setup is published before the first update, once the show has rendered;
  `once()` row says it rejects when the show does not compile.
- R3: `layout` row is "a layout engine from `loadYoga(wasm)`".
- R4: `media:restart` example uses `sourceId`; the handle member is `event(event)`, routed by
  `sourceId`.
- R5: context table marks `frames` for DOM and OBS.
- R6: DOM example narrows `querySelector<HTMLElement>` with a null check; notes `scene` is optional.
- R7: host requirements say Yoga is compiled at runtime; Workers pass `loadYoga(wasm)` with
  `vignette/yoga.wasm`.
- R8: `bundle` compiles every `*.frame.tsx`/`.jsx` under the show's directory and the `assets/`
  directory next to it.
- R9: `assets` row says `scanAssets` is from `vignette/bundle`, and that `assets` is required for
  `Image`/`Video`; §1 table lists `scanAssets` under `vignette/bundle`.
- R10: `frame()` example has `name: "Scoreboard"` plus one sentence on `name`.
- R11: §6 status order is `downloading-assets` → `connecting` → `synchronising` → `settled`; the
  asset-stage diagram shows connecting after verify.
- R12: context table gains `request()`; OBS plugin section says a handle without `update` is
  re-created and `input` may carry `muted`.
- R13: §5 example passes `frames={[Scoreboard]}`, with a bullet on inline frames; §4's preview
  sentence too.
- R14: Guarantees say "your show's React tree", with the `<Stream>` error-boundary caveat.
- R15: §3 says `--source` applies with `--obs`, and that `preview` renders `Frame` sources empty.
- Wave 3B: §5 gains the shared-source `moveBefore`/`append` sentence.
- Wave 3A note 5: §6 "different show ID than the one the target already manages".
- Plan §3.9 README FIX 1–2: §2 managed names are `vignette/<show>/<scene>` and
  `vignette/<show>/<source>`; scene/source ID collision and `DUPLICATE_PLACEMENT` stated.
- §1 table: root lists `createTarget`, `toSseEvent`, `fromSse`.
- §5 hooks list adds `useSetup()` and `useStreamEvents(handler)`; `<Stage>` without `scene` follows
  `activeScene`.
- §6 example imports `fromSse` from `vignette/obs` and passes the URL (reconnecting) rather than a
  one-shot `fetch` response; options paragraph lists `url`, `password`, `builtins`, `retry`.
- §7 `Color` example uses `ContentSizeSchema`; the `createTarget` example finds the active scene in
  the `scenes` array.

CLI flags in §3/§4 were checked against 4B's `src/cli/options.ts` and 4A's `build.ts` (`dist/server.js`)
and match.

**README / implementation mismatches left open.**

- §7 shows `ColorView` (`vignette/react`), `colorDom` (`vignette/dom`) and `colorObs`
  (`vignette/obs`, also in "Registering plugins" with `builtins: false`) as exports; none of the
  built-in plugins is exported (Wave 3B note 8). Cleanup decides: export them or change the README.
- §7's `MoqView` example (`lazy` + props on `<MoqWatch>`) is illustrative; the real one is in
  `packages/moq/src/react.tsx`.
- V1 (`DomHandle.activate`) and V8 (inline React sources remount) are still not in the README.
- `vignette dev` and `vignette preview` render with built-in React views only, so a show using a
  custom kind (the kitchen sink's `moq`) reports `missing source plugin for kind "moq"` there;
  README §3 offers `--source` for OBS only. Either a React-side `--source` or a README sentence is
  needed.

**Gates** (at the end of this wave): `pnpm build`, `typecheck`, `test` (32 files, 160 tests),
`format:check` and `test:e2e` (5 Playwright tests, run with `VIGNETTE_TEST_PORT=4319` because
another local app holds 4173) pass. `pnpm lint` fails only in 4A's
`src/cli/build.test.ts` and `src/vite/dev-composer.test.ts`. `publish:check` fails in
`scripts/check-npm-package.mjs` ("unexpected npm exports"), which still expects the `./cli` export
4B removed (V10). One full `pnpm test` run timed out in `vite/dev-composer.test.ts` while 4A was
editing; it passed alone and on two reruns. `test:obs-integration` skips without its environment.

### Cleanup C1 notes

**Dependency.** `xstate` 5.33.3 (exact pin, like the other dependencies) is a regular dependency of
`vignette`. Nothing else was added.

**Public signatures.**

```ts
// vignette (target/)
interface CreateTargetOptions<Handle extends TargetHandle = TargetHandle, Context extends PluginContextBase = PluginContextBase> {
  readonly kind: string;
  readonly sources?: readonly TargetSourcePlugin<Handle, Context>[];
  readonly assets?: AssetStore;
  readonly fetchAsset?: AssetFetcher;
  readonly checkPlugins?: boolean;                                        // new, default true
  connection?(report: (connection: TargetConnection) => void): () => void; // new
  context?(base: PluginContextBase): Context;
  update(snapshot: Snapshot, handles: ReadonlyMap<string, Handle>): void | Promise<void>;
  event?(event: ShowEvent, handles: ReadonlyMap<string, Handle>): void | Promise<void>;
  dispose?(): void | Promise<void>;
}
interface Target {   // unchanged
  follow(stream: AsyncIterable<StreamMessage>): () => void;
  apply(message: StreamMessage): void;
  readonly status: TargetStatus;
  subscribe(listener: () => void): () => void;
  settled(revision?: number): Promise<void>;
  dispose(): Promise<void>;
}
interface TargetStatus {
  readonly phase: TargetPhase;              // union unchanged
  readonly revision: TargetRevision;
  readonly assets?: TargetAssetProgress;
  readonly sources: Readonly<Record<string, SourceStatus>>;
  readonly error?: Error;
  readonly connection?: TargetConnection;   // new
}
interface TargetConnection { readonly phase: ConnectionPhase; readonly error?: Error }
// vignette (stream/)
type ConnectionPhase = "connecting" | "open" | "retry-wait" | "closed";
interface SseConnection { readonly phase: ConnectionPhase; readonly attempt: number; readonly error?: Error }
function fromSse(input: SseInput, options?: FromSseOptions): AsyncIterable<StreamMessage>;
interface FromSseOptions { readonly signal?: AbortSignal; readonly retry?: SseRetryOptions; readonly onConnection?: (state: SseConnection) => void }
// vignette (compose/): `Composer`, `ComposeOptions`, `ComposerStatus`, `ComposerPhase` unchanged
function compose(show: ReactElement | ComponentType, options?: ComposeOptions): Composer;
```

`SseConnection` is assignable to `TargetConnection`, so C3 can pass `fromSse`'s report straight
through: `createTarget({ connection: (report) => { … fromSse(url, { onConnection: report }) … } })`.

**Decisions.**

1. Connection reporting is `CreateTargetOptions.connection(report) => stop` (picked over a
   `setConnection` on an `update` context: a connection changes when nothing is being applied).
   The kernel runs it as a root-level `fromCallback` actor; `stop` runs on dispose. The kernel
   does not fold `connection` into `phase`; C2 decides whether OBS's phase should.
2. Settlement (decision #11): `update()` already returned `void | Promise<void>`; the kernel now
   documents that the returned promise is the only "revision N settled" signal, and a rejection
   is a failed apply of N (status `error`, `settled(n ≤ N)` rejects, the next successful apply
   clears it). `settled()` waiters are no longer machine state: `settled(rev)` is XState's
   `waitFor` over the actor (settled ≥ rev → resolve; `error` state, disposal, or a failed apply
   ≥ rev → reject). The composer's waiters work the same way.
3. `checkPlugins: false`: the plugin check passes; `create` for a kind without a plugin rejects
   with `no plugin for kind "x"`, so that source is `error` and is absent from `handles`. The
   message is not in `TargetStatus` (per-source errors never were; `sources[id]` is a bare
   `SourceStatus`). If C3 needs the message, add `TargetStatus.sourceErrors` deliberately.
4. Asset store stays the plain `createAssetStore` map (an XState version would be longer; its
   only decision is "stored or in flight → skip").
5. Show identity: the composer passes its last compiled snapshot to `compile`; a lowered tree
   with another `id` or `canvas` fails with `SHOW_IDENTITY_CHANGED` at path `show` and the last
   snapshot stays live. Setup `kinds` accumulate (union of every kind used, sorted), so a kind
   that disappears and returns does not re-publish. A re-published setup resets every target
   (handles disposed, revisions restart), which is how targets already treat a new setup.

**Deleted as unnecessary (kernel, §6.2).**

- Events: `pluginsChecked` (now the `checkPlugins` invoke's done/error), `assetDone`/
  `assetFailed`/`assetsComplete`/`assetsFailed` (folded into `assetProgress` and `assetsDone`),
  `applied`/`applyFailed` (the `apply` invoke's done; its output carries failed handle updates
  and the medium error), `awaitRevision` (waiters are `waitFor`), `handleUpdated`.
- Effects: every effect type and the serial effect runner; `evictAssets`/`disposeHandle`/
  `dispatchEvent` became fire-and-forget actions, `updateHandle`/`disposeHandle` for a diff run
  inside the `apply` actor before the medium renders, `resolve/rejectWaiter` are gone.
- State: `generation` and per-create `token` (superseded work is cancelled by stopping its actor:
  leaving a state stops the asset stage or apply; a removed source, a new setup or disposal
  stops its `create`, whose actor then disposes a late handle itself), `applying`/`reapply`
  (the `ready.applying` substate; a handle arriving mid-apply sets `pending ??= snapshot`, and
  `ready.idle` applies whenever something is pending), `stale` (an entry keeps the source its
  handle reflects, `current`, and the next diff updates it), `waiters`, `config.fetchesFromServe`
  and the MISSING_SERVE pre-check (the default fetcher now fails with the `MISSING_SERVE:`
  message; the asset stage reports it).
- Composer (§6.1): `compileStarted`, `compiled`/`compileFailed` events (the `compile` invoke's
  output), `awaitRevision`, `waiters`, `scheduled`/`compiling` coalescing flags (one compile at a
  time; commits during it raise `commitRevision`, and a compile that finishes behind starts
  another from the transient `compiled` state), every effect type. A `renderFailed` moves to
  `error`, which stops the compile in flight, so a stale "no `<Show>`" never replaces it.

**Behaviour changes worth knowing (C2/C3).**

1. Events (`media:restart`) are routed when they arrive, not queued behind an apply in flight
   (Wave 3A note 3 no longer holds). Handles disposed by a new setup are disposed at once.
2. `dispose()` no longer waits for an apply in flight: the actor stops it and nobody listens to
   its result, so `obsTarget`'s "release the runner first" ordering is no longer required.
3. `fromSse(url)` reads each response eagerly into a queue (no per-message backpressure); a
   malformed record still ends iteration with its error and is not retried. `onConnection` is
   reported for URL inputs only; `Response`/body inputs read once as before.
4. `checking-plugins` is observable for one microtask after each setup.

**Line counts** (non-test, `wc -l`). `target/`: 1411 → 1243 (`machine.ts` 709 + `kernel.ts` 437 →
`kernel-machine.ts` 523 + `kernel.ts` 403; `serveFetcher` moved to `asset-store.ts`, `frameUrl` to
`plugins.ts`). `compose/`: 662 → 556 (`machine.ts` 306 → 161, `compose.ts` 356 → 395).
`stream/sse.ts`: 188 → 366 (the §6.5 machine and `onConnection`). Budget: machine + kernel
excluding type declarations, comments and blank lines is 583 lines (315 + 268), over the 350
budget; the formatted XState config alone is ~200 of it. Further cuts would trade readability
(inlining the diff, dropping the per-asset progress events) and were not made.

**Edits outside scope.** `src/vite/dev-composer.ts`: `reload` now replaces the composer when
`settled()` rejects with `SHOW_IDENTITY_CHANGED` in `composer.status.diagnostics`; the snapshot
comparison `sameIdentity` and `settledSnapshot` are deleted (V13 now has one mechanism, the
diagnostic; the manifest check is unchanged). Verified with a throwaway dev server: renaming the
show's `id` replaced the composer and the client reconnected to the new setup. No edits were
needed in `obs`, `react`, `dom`, `frame`, `cli` or `bundle`. `target/machine.test.ts` was moved
to `target/kernel-machine.test.ts` with its module.

**Gates.** `pnpm build`, `typecheck`, `test` (32 files, 162 tests), `lint`, `format:check` pass.

### Cleanup C2 notes

**Public API** (`vignette/obs`).

```ts
function obsTarget(options?: ObsTargetOptions): Target;   // the kernel's Target, unwrapped
interface ObsTargetOptions {
  readonly url?: string;                 // default ws://127.0.0.1:4455
  readonly password?: string;
  readonly assets?: ObsAssetOptions;     // { fetch?: AssetFetcher; dir?: string }
  readonly frames?: (frame: string, sourceId: string) => string;
  readonly sources?: readonly ObsSourcePlugin[];
  readonly builtins?: boolean;           // default true
  readonly retry?: ObsRetryOptions;      // { initialDelayMs?, maximumDelayMs?, jitterRatio?, maximumNotReadyAttempts? }
  readonly transport?: ObsTransport;     // tests: FakeObs
  readonly clock?: ObsClock;             // { schedule(ms, cb): cancel; random(): number }; tests: ManualClock
}
interface ObsSourcePlugin<Def = unknown> extends SourcePluginBase {
  load?(): Promise<void>;
  create(source: SourceOf<Def>, context: ObsPluginContext): ObsHandle<Def> | Promise<ObsHandle<Def>>;
}
interface ObsHandle<Def = unknown> {
  readonly input: ObsInput;              // { kind; settings: ObsJsonObject; muted?: boolean }
  update?(source: SourceOf<Def>): void | Promise<void>;   // absent → re-created on change
  dispose?(): void | Promise<void>;
  event?(event: ShowEvent): void | Promise<void>;
}
interface ObsPluginContext extends PluginContextBase {   // canvas, signal, assets, frames
  readonly inputKinds: ReadonlySet<string>;
  port(): Promise<number>;
  request(sourceId: string, requestType: string, requestData?: ObsJsonObject): Promise<ObsJsonObject>;
}
export { colorObs, imageObs, videoObs, browserObs, frameObs, fromSse };
export type { ObsAssetOptions, ObsClock, ObsRetryOptions, ObsTargetOptions, ObsHandle, ObsInput, ObsPluginContext, ObsSourcePlugin, ObsTransport };
```

Signatures of `ObsSourcePlugin`, `ObsHandle` and `ObsPluginContext` are unchanged; `ObsInput`,
`ObsAssetOptions`, `ObsClock` and `ObsRetryOptions` are newly exported (they appear in public
signatures). `ObsClock`/`ObsRetryOptions` moved from the deleted `runner.ts` to `target.ts`.

**Machine** (`obs/machine.ts`, `obsMachine`). Parallel regions:

- `connection`: `disconnected` (→ `connecting` once a snapshot is desired) → `connecting`
  (invoke `connect`) → `connected` (invoke `events`; resets `attempt`/`error`) ↔ `retry-wait`
  (invoke `disconnect` and `timer(attempt)`; `attempt++` on exit; `timer` → `connecting`);
  `closed` 4011 → `terminal` (no exits). `closed` (other) and the internal `lost` → `retry-wait`.
- `convergence`: `idle` (→ `observing` when connected with a desired snapshot) → `observing`
  (entry `epoch++`; invoke `observe(show)`; `remoteChanged` re-enters) → `planning` (transient;
  entry action `plan` assigns `planObsUpdate(...)`) → `failed` (problems) | `settled` (empty
  plan) | `executing` (invoke `execute({ plan, epoch })`; `onDone` guarded on its epoch →
  `observing`). `settled`/`failed` record `outcome = { desired, error? }` and re-plan against the
  current observation when `desired` changes (`stale` guard); `remoteChanged` → `observing`.
  `paused.notReady` (invoke `timer(notReady - 1)` → `observing`), `paused.collection`
  (`collectionChanged` → `idle`). Region-level: `collectionChanging` → `paused.collection`;
  `closed`/`lost` → `idle`. A 207 from `observe`/`execute` below `maximumNotReady` →
  `paused.notReady`; anything else raises `lost` (connection region → `retry-wait`).
- Stale results: leaving a state stops its actor, so XState drops a late `observe`/`execute`
  result; `execute` gets `() => !signal.aborted` as the executor's validity check (replaces
  `isValid` closures over `epoch`), and its output is the epoch it ran for, checked on `onDone`.
- Actors provided by `obsTarget`: `connect`/`disconnect` (`fromPromise` over `ObsTransport`;
  disconnect failures are swallowed), `observe` (`bootstrapObsState`), `execute`
  (`executeObsPlan`), `events` (`fromCallback` over `transport.on` via `subscribeToObsEvents`,
  which now sends machine events directly), `timer` (`fromCallback` over `ObsClock`, delay
  `backoff(attempt, retry, clock.random())`). `ManualClock` needed no change.

**Settlement** (decision #11). `update(snapshot, handles)` refuses another show's snapshot
(`ObsPreflightError`, before the machine sees it), sends `apply`, and `waitFor`s
`context.outcome.desired === <this apply's desired>`: resolves on settled, rejects with the
planning error on failed, rejects with the close error when the connection region is `terminal`,
and rejects (XState "actor terminated") when the target is disposed. Identity of the desired
object, not the revision, is compared, because the kernel re-applies the same revision when a
handle arrives. Plugin `create` waits the same way for the first observation (`inputKinds`).
`dispose` stops the actor and disconnects.

**Status mapping** (README §6). `TargetStatus.phase` comes only from the kernel; the connection
region is reported as `status.connection` (`connecting` → `{ phase: "connecting" }`, `connected`
→ `open`, `retry-wait` → `{ phase: "retry-wait", error }`, `terminal` → `{ phase: "closed",
error }`; nothing before the first connect). README phases derive as:

| README          | `TargetStatus`                                                                 |
| --------------- | ------------------------------------------------------------------------------ |
| `downloading-assets` | `phase: "downloading-assets"` (after `checking-plugins`)                  |
| `connecting`    | `phase: "synchronising"` and `connection.phase: "connecting"`                   |
| `synchronising` | `phase: "synchronising"` and `connection.phase: "open"`                         |
| `settled`       | `phase: "settled"` and `connection.phase: "open"`                               |
| `disconnected`  | `connection.phase: "retry-wait"` (`connection.error` is why)                    |
| `error`         | `phase: "error"`, or `connection.phase: "closed"` (4011) while settled          |

Gap the kernel cannot express today: when OBS changes underneath a settled target
(`remoteChanged`, a collection switch) the machine re-observes and re-converges the same
revision with no `update` in flight, so `phase` stays `settled` while OBS is being corrected.
To show that as `synchronising`, the kernel would need the medium to be able to mark itself
unsettled without a new revision, e.g. a `converging: boolean` on the `connection` report that
`phaseOf` folds into `synchronising`. Not done (kernel is out of C2's scope); no kernel change was
made.

**Consumers to update (not C2's files).** `src/cli/obs.ts` (C4) prints `obs: <phase>` only, so
it no longer prints `connecting`/`disconnected` lines; it should append `status.connection`
(e.g. `obs: synchronising (retry-wait: <error>)`). `src/cli/dev.ts` likewise.

**Tests.** `obs/machine.test.ts` rewritten to drive `createActor(obsMachine.provide({ actors }))`
with fake actors (10 cases: idle until apply; connect → execute → re-observe → settle; re-plan
without re-reading; stale epoch dropped across a collection switch; 207 pause/backoff then
reconnect; connect backoff; 4011 terminal; reconnect on other close; re-observe on remote
change; planning failure stays connected). `obs/target.test.ts` adapted (phases are the
kernel's, connection asserted through `status.connection`; the remote-change test waits for the
re-read rather than a `synchronising` phase) plus one case: `settled(1)` resolves, then a 4011
during revision 2's retry rejects `settled(2)` with the close error and reports
`connection: { phase: "closed", error }`. `obs-integration.spec.ts` also asserts
`connection: { phase: "open" }`. `packages/moq` needed no change.

**Line counts** (non-test, excluding `testing.ts`). `obs/`: 2992 → 2549 (`runner.ts` 310 → 0,
`machine.ts` 556 → 305, `target.ts` 188 → 286 (absorbed `ObsClock`/`ObsRetryOptions`/backoff
and the actor wiring), `events.ts` 38 → 47, `index.ts` 4 → 15). Over the 2,200 target: the
untouchable planner/executor/operations are 1,069 lines and `bootstrap.ts` (225) is shaped by the
house `require-zod-output-type` rule; a trial trim of it was rejected by lint. Nothing else was
unreachable under the statechart except `ObsExecutionResult.interrupted`, which `target.ts` now
ignores (left in the executor, which is kept by design).

**Gates.** `pnpm build`, `typecheck`, `test` (32 files, 164 tests) pass. `lint` and
`format:check` pass for every C2 file; at the time of writing they fail only in C3/C4 files
(`src/frame/mount.tsx`, `src/react/preview-page.tsx`, `src/react/stream.test.tsx`,
`examples/kitchen-sink/tests/dom.spec.ts`; `AGENTS.md`, `docs/architecture.md`,
`docs/compatibility-contract.md`).

### Cleanup C3 notes

**Exports.**

- `vignette/react`: `Stream`, `StreamProps`, `Stage`, `StageProps`, `useCanvas`, `useFrameUrl`,
  `useScene`, `useSetup`, `useSnapshot`, `useStreamEvents`, `useStreamStatus`, `useAsset`,
  `ReactSourcePlugin`, `ReactSourceViewProps`, `StreamEventListener`, `ColorView`, `ImageView`,
  `VideoView`, `BrowserView`, `FrameView`, `fromSse`. Deleted: `StreamStatus`, `StreamConnection`,
  `<Stream frames>`, `InlineFrame`. New prop `<Stream checkPlugins?: boolean>` (default `true`).
- `vignette/dom`: `domTarget`, `DomTargetOptions`, `DomHandle`, `DomPluginContext`,
  `DomSourcePlugin`, `colorDom`, `imageDom`, `videoDom`, `browserDom`, `frameDom`, `fromSse`.
- `vignette/frame`: `frame`, `NoFrameParamsSchema`, `FrameDefinition`, `FrameOptions`,
  `FrameParamsInput`, `FrameParamsSchema`, `NoFrameParams`, `ParameterlessFrameOptions`.
- `vignette/frame/mount` (new): `mountFrames`, `FrameExports`, `MountFramesOptions`.

**Decisions.**

1. React plugin context gains `frames` as a hook, `useFrameUrl(frame, sourceId)` (smaller than
   passing a context into `View` props); it is the kernel's `frameUrl` over the stream's setup.
   README §7 context table: React column of `frames` is `useFrameUrl()`.
2. `useStreamStatus()` is the kernel's `TargetStatus`; the only adjustment is that the kernel's
   `idle` reads `connecting` (or `disconnected` once the SSE connection is `closed`).
   `connection` is reported for `url` streams only (`source` iterables have none).
3. Kernel message for per-source errors: not added. `sources[id]` stays a bare `"error"`; a
   message needs a new `TargetStatus` field plus its equality check, more than one line, and
   nothing in the clients needs it yet. No kernel edits.
4. V1: `DomHandle.activate?()` kept. Folding it into `update(source, { active })` is the same
   size but makes `update` fire without a change, so every DOM plugin (moq's re-applies its
   attributes) would have to branch on it.
5. V8: `<Stage>` without `scene` renders every scene, each in a `[data-vignette-scene=<id>]` box,
   the shown one visible and the rest `visibility: hidden` (still running, as in the DOM target
   and OBS). Shared sources are claimed only by the shown scene's boxes. A `<Stage scene=…>`
   renders just its scene. `AppearanceContext` for inline sources counts the scene becoming shown.
6. Preview pages: `src/react/preview-page.tsx` (`mountPreview(stream)`: `<QueryClientProvider>
   <Stream url checkPlugins={false}><Stage scene={?scene}/>` plus the screenshot ready marker)
   is the one page; `vite/pages.ts` has the one HTML template (`previewHtml(script, background)`)
   and `previewEntry(stream)`, which imports the built `dist/react/preview-page.js` by absolute
   path (it is not a package export). Dev, `vignette build` and `vignette preview` all use it.
   `vignette preview` now also waits until frame pages in the stage have rendered.

**README sentences for C4.**

- §5 React example: `const { phase, revision, error } = useStreamStatus();` and
  `<small>{phase} · r{revision.settled} {error?.message}</small>`; add: "`useStreamStatus()` is
  the target status every target reports (`phase`, `revision: { desired, settled }`, `sources`,
  `error`), plus `connection` for a `url` stream."
- §5 React: "`checkPlugins={false}` renders a kind without a plugin as an empty box (its source
  shows `error`) instead of failing the stream; the preview pages use it."
- §5 React: "`sources`, `builtins` and `checkPlugins` are read when the stream connects; changing
  them later has no effect until `url` or `source` changes." (V9)
- §5 React identity paragraph: inline sources also stay mounted across scene switches in a stage
  that follows the active scene.
- §7 DOM plugin: "A handle may also implement `activate()`, called when its element enters the
  shown scene; the built-in video uses it for `restartOnShow`." (V1)
- §1 table and §4: `vignette/frame` is `frame`; `mountFrames` is `vignette/frame/mount`.
- §3: delete "`Frame` sources render empty in a preview…"; frames render as iframes like any client.
- §7 context table: React `frames` → `useFrameUrl()`.

**Edits outside scope.** `src/bundle/bundle.ts` (generated entry imports `vignette/frame/mount`);
`src/cli/build.ts` (`previewEntry("/stream")`, `discoverFrames` import dropped);
`src/vite/plugin.ts` (`previewEntry(streamPath)`); `examples/kitchen-sink/src/show.tsx` (the
focus clock's title follows the highlighted card, so `dom.spec.ts` has a params change; the
`main.clock` params the production and OBS tests check are unchanged).

**Found, not fixed (C4, `src/bundle`).** `bundle()` compiles JSX in dev mode when the ambient
`NODE_ENV` is not `production` (`mode: "production"` and the `define` do not set it), so a
`bundle()` run under `NODE_ENV=development` or `test` emits `jsxDEV` calls against production
React and every frame page throws `jsxDEV is not a function`. Reproduced with
`NODE_ENV=development node scripts/bundle.mjs`; one e2e run hit it from a frames.js written
during a concurrent build.

**Line counts.** `vite/pages.ts` 67 → 43; `cli/preview.ts` 258 → 219; new
`react/preview-page.tsx` 50 (page code: ~119 → ~96). `react/` non-test 1,237 → 1,256 including
the preview page (1,206 without).

**Gates.** `pnpm build`, `typecheck`, `test` (32 files, 164 tests), `lint` pass;
`VIGNETTE_TEST_PORT=4319 pnpm test:e2e` 5/5. `format:check` fails only on `AGENTS.md`,
`docs/architecture.md`, `docs/compatibility-contract.md` (C4's files).

### Cleanup C4 notes

**Dependencies** (`packages/vignette/package.json`, after).

| Field | Entries |
| ----- | ------- |
| `dependencies` | `obs-websocket-js` 5.0.8, `react-reconciler` 0.33.0, `tinyglobby` 0.2.17, `xstate` 5.33.3, `yoga-layout` 3.2.1, `zod` 4.6.5 |
| `peerDependencies` | `react` ^19.2.0; optional: `react-dom` ^19.2.0, `@tanstack/react-query` ^5.100.0, `playwright` ^1.50.0, `vite` ^8.0.0 |
| `devDependencies` | `@tanstack/react-query`, `@types/node`, `@types/react`, `@types/react-dom`, `@types/react-reconciler`, `playwright` 1.61.1, `react`, `react-dom`, `vite` 8.1.4 |

`src/bundle/load-vite.ts` (`loadVite()`) is the one lazy import. Value imports of `vite` were in
`cli/dev.ts`, `cli/build.ts` and `vite/dev-composer.ts`; `createDevComposer` is now async (it
loads `createServerModuleRunner`) and the plugin's `configureServer` awaits it. Pure-OBS check
(throwaway script, deleted): with a `module.registerHooks` resolver that throws for `vite` and
`playwright`, importing `dist/index.js`, `dist/obs/index.js`, `dist/bundle/index.js`,
`dist/vite/index.js` and `dist/cli/cli.js` attempted neither; `runCli(["bundle", …])` then failed
with the `pnpm add -D vite` message.

**V19 decision: loop, not XState.** The §6.5 machine had five transitions (`opened`, `message`
resets backoff, `ended` → `retry-wait`, `failed` → `retry-wait` or fatal `closed`, `stop` →
`closed`); every one is a line of a `while` loop with `attempt`/`error` variables, and the machine
added none the loop lacks. Its cost was five event interfaces, three `SAFETY` casts, a `forward`
action that throws unless `provide`d, a subscription that de-duplicates reports, and an eager queue
bridging push to pull (which also dropped backpressure). The loop yields straight from the body
(backpressure restored); stopping iteration aborts an internal controller so `return()` cancels a
pending `fetch` or backoff at once, as the machine's `stop` did. Reported sequences are identical
(`sse.test.ts` unchanged). AGENTS.md records the rule: XState for lifecycles with concurrent
concerns, a loop for one-phase loops.

**Other changes.**

- `cli/obs.ts` `describeStatus` (exported) appends `status.connection` unless `open`
  (`obs: synchronising (retry-wait: <error>)`), per C2; `cli/dev.ts` logs the same lines.
- C3's "found, not fixed": `bundle()` and `vignette build` set `oxc: { jsx: { development: false } }`
  so frames and `show.js` compile production JSX whatever `NODE_ENV` is. Verified:
  `NODE_ENV=development` `bundle()` of the kitchen sink emits no `jsxDEV`.
- `scripts/check-docs.mjs` collapsed to one package (and its repeated comments); it resolved
  `./dist/frame/mount.d.ts` to a non-existent `src/frame/mount.ts`, now `.ts` or `.tsx`.
- `README.vision.md` moved to `README.md` (untracked, so `mv`, not `git mv`); removed from
  `.oxfmtrc.json`'s ignore list and formatted; links in `docs/*` and the kitchen-sink README updated.

**README changes beyond the brief's list.**

- §1: install line adds `react-dom @tanstack/react-query` and `pnpm add -D vite`, plus a sentence
  on which pieces need which (R16); table rows for `vignette/obs/testing`, `vignette/frame/mount`,
  built-in plugin names per entry, `loadYoga` in the root.
- §2: `<Image fit>` moved to the `<Layer>` (`fit` is a layer prop; the example did not typecheck);
  `Browser` row lists `viewport` and `shutdownWhenHidden`.
- §3: id/canvas edit starts a new composer and clients reconnect; preview has built-in views only
  (custom kinds empty) and needs `playwright`.
- §4: `dist/` layout, `PORT`/`HOST`/`PUBLIC_ORIGIN` (R16); `bundle` needs `vite`; the Vite plugin
  sentence corrected (it composes and serves inside `vite dev`, it does not build frames); step 5
  says every target opens the frame page; `stream()` row states `SHOW_IDENTITY_CHANGED` and that
  setup re-publishes only for a new kind; step 4 describes `fromSse` `onConnection`.
- §5: intro no longer says "connection state is a query"; the status example used `r{revision}`
  (an object) and now uses `revision.settled` plus `connection?.phase`; the `Scoreboard` import is
  gone; bullets for status, plugins/`checkPlugins`/V9, `useFrameUrl`; target-contract status row
  lists per-source state and `connection`.
- §6: phase mapping per C2 (diagram and status paragraph); `transport`/`clock` options.
- §7: `useFrameUrl()` in the context table; DOM `activate()` (V1); `checkPlugins: false` under
  "Registering plugins"; "A new target" explains `update` settlement, `connection(report)` and
  `checkPlugins`.
- Guarantees: the error-boundary caveat drops "a frame component that throws" (frames are iframes).

**Not reconciled / for the orchestrator.**

- `src/target/status.ts`: `TargetConnection` declares a `connection?: TargetConnection` member (a
  copy of `TargetStatus.connection`'s doc and field); looks accidental. Not my file.
- C2's gap (OBS re-converging the same revision while `phase` stays `settled`) is not in the README.
- `packages/vignette` has no README of its own, so the npm page will be empty; copying the root
  README at `prepack` (or adding `README.md` to the package) is a one-liner if wanted.
- §7's `MoqView` (`lazy` `<MoqWatch>`) stays illustrative (4C note).

**Gates.** `pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm format:check && pnpm
publish:check` pass (32 files, 164 tests; docs 236/236). Playwright e2e not run (orchestrator).

### Final size

Non-test `.ts`/`.tsx` lines under `packages/vignette/src` (`wc -l`, after C2, C3 and C4):

| Directory | Lines |
| --------- | ----- |
| `core` | 1,697 |
| `react-authoring` | 832 |
| `compose` | 556 |
| `stream` | 546 |
| `target` | 1,243 |
| `obs` | 3,021 (2,549 without `testing.ts`) |
| `react` | 1,256 |
| `dom` | 614 |
| `frame` | 320 |
| `bundle` | 230 |
| `vite` | 652 |
| `cli` | 1,149 |
| `index.ts` | 62 |
| **Total** | **12,178** (12,400 before the refactor; plan §4 budgeted ~6,000) |
