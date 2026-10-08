# Running dynamic Vignette compositions on Cloudflare

Research date: **7 October 2026**.

## Recommendation

Build a platform-owned **composition supervisor Durable Object**, scoped to one tenant/project/live
session. Store immutable build artifacts separately, load generated code through **Dynamic
Workers**, and use a **Durable Object facet** when that code needs a persistent live composer or its
own durable application state. Expose narrowly scoped platform capabilities through Workers RPC.
Keep DOM and OBS targets consuming the existing **composer → stream → target** pipeline.

Start with generated composition structure and a library of trusted frames. Add arbitrary generated
frames only after creating a separate browser-origin security boundary. For compositions that only
compute structure from explicit input, use a stateless dynamic compilation path instead of requiring
facets everywhere.

The central distinction is between **code version**, **durable application state**, and **live
stream revision**. Give each its own identity and lifecycle. A warm isolate, React hook state, or an
RPC object reference cannot substitute for a persisted show.

This report is an implementation proposal grounded in the two repositories and current primary
documentation. The architecture, interfaces, defaults, and rollout below are recommendations, not an
already implemented or deployed system.

## What the repositories already provide

### Vignette DX

Inspected `/Users/jameswilliams/vignette-dx`, HEAD `ba45b4e731ccc2f040e4b6e5d26b9f2fffda04d6`,
including the existing local changes. Those changes were left intact. Relevant source:

- [`CompositionDefinition`](../packages/react/src/composition.ts): explicit project ID, canvas,
  extensions, and React component.
- [`ComposerRoot`](../packages/react/src/root.ts): local React graph, compilation, `settled()`,
  errors, and stream publishing.
- [`StreamHub`](../packages/core/src/stream-hub.ts): replay of setup and latest update to new
  subscribers; events are live-only.
- [`StreamMessage` and `TargetRuntime`](../packages/core/src/stream.ts): closed setup/update/event
  contract.
- [`Workers Yoga entrypoint`](../packages/core/src/layout/layout-yoga-workerd.ts): imports the
  vendored Wasm as a precompiled module.
- [`Frame SSR`](../packages/frame/src/server.ts) and [`View`](../packages/frame/src/view.ts): build
  metadata, frame routes, SSR, and browser hydration.
- [`DOM revision handling`](../packages/target-dom/src/dom-target.ts) and
  [`OBS scheduler`](../packages/target-obs/src/scheduler.ts): lower snapshot revisions are ignored.

The useful boundary is already there: targets consume immutable plain snapshots, while React and
Yoga stay with the composer. Dynamic execution does not require targets to know where the component
came from.

### Cloudflare starter, `dx/cleanup`

Inspected the local checkout and verified its commit matches the remote branch:
`61b9f04818c94a2f47c9ea5b623f754e7a0ba8f8`. It uses Vignette **0.4.1**. Main evidence:

- [`worker.tsx`](https://github.com/changesbyjames/vignette-cloudflare-starter/blob/61b9f04818c94a2f47c9ea5b623f754e7a0ba8f8/apps/composition/src/worker.tsx):
  one DO named `default`; lazy boot restores the store, creates a composer, and renders once.
- [`durable.ts`](https://github.com/changesbyjames/vignette-cloudflare-starter/blob/61b9f04818c94a2f47c9ea5b623f754e7a0ba8f8/apps/composition/src/state/durable.ts):
  persists serializable store context rather than React objects.
- [`vite.config.ts`](https://github.com/changesbyjames/vignette-cloudflare-starter/blob/61b9f04818c94a2f47c9ea5b623f754e7a0ba8f8/apps/composition/vite.config.ts):
  build-time discovery of frames and assets through `vignette()`.
- [`wrangler.jsonc`](https://github.com/changesbyjames/vignette-cloudflare-starter/blob/61b9f04818c94a2f47c9ea5b623f754e7a0ba8f8/apps/composition/wrangler.jsonc):
  SQLite-backed DO, static assets, compatibility date `2026-07-08`.

There are **two independent SSE feeds**:

| Feed                            | Meaning                                                  | Consumers                        |
| ------------------------------- | -------------------------------------------------------- | -------------------------------- |
| `/api/stream`                   | Composition setup, structural snapshots, one-shot events | DOM stage and OBS target runtime |
| `/__vignette/store/composition` | Application state such as the current title              | Hydrated React frames            |

A title change updates the existing frame through the store feed. It does not rerender the
composition or replace the frame URL. Preserve this behavior when introducing generated code.

What is missing for SaaS is platform routing/authentication, dynamic builds, code isolation,
tenant/session identities, publication and rollback, resource quotas, and recovery across versions.
The existing single `default` instance and statically imported component are the seams to replace.

## Cloudflare primitives and their roles

### Dynamic Workers / Worker Loader

Dynamic Workers execute runtime-supplied code in an isolated Worker. Cloudflare announced open beta
for paid Workers customers in March 2026; the documentation reviewed here does not establish a
subsequent GA announcement. Use the current product documentation rather than older closed-beta
examples. [Overview](https://developers.cloudflare.com/dynamic-workers/),
[open-beta announcement](https://developers.cloudflare.com/changelog/post/2026-03-24-dynamic-workers-open-beta/).

Configure a `worker_loaders` binding. `LOADER.load(code)` creates a fresh Worker;
`LOADER.get(id, callback)` can reuse code/isolate caches. A given ID must always resolve to
identical code/configuration. Repeated calls are **not guaranteed to reach the same isolate**.
Module maps support JavaScript and Wasm modules, among other types. `get()` returns a stub
synchronously; loading failures surface on invocation.
[API reference](https://developers.cloudflare.com/dynamic-workers/api-reference/).

**Application decision:** use `get()` with an immutable artifact/configuration identity for saved
compositions and previews. Reserve `load()` for genuinely disposable executions. Never import
generated code into the trusted supervisor's isolate, including for validation or SSR.

### Durable Object facets

A facet instantiates a dynamically loaded `DurableObject` class beneath a deployed supervisor DO. It
has a separate SQLite database, isolated from the supervisor's. Obtain the named class with
`worker.getDurableObjectClass("CompositionActor")`, then return `{ class: ... }` from
`ctx.facets.get(name, callback)`. The resulting stub supports fetch and RPC.

The startup callback runs when the facet starts or resumes, not on every access.
`facets.abort(name, reason)` invalidates existing stubs but preserves storage, allowing another
class version to start. `facets.delete(name)` permanently removes storage. Facet name controls
storage identity; loader ID controls code identity.
[Facet documentation](https://developers.cloudflare.com/dynamic-workers/usage/durable-object-facets/).

**Application decision:** use one supervisor for one project/session and a stable facet name such as
`composer`. For staging, use a separate supervisor session and explicitly initialized state. Do not
assume that changing a loader ID changes an already running facet.

### WorkerEntrypoint, RpcTarget, and durable actors

| Primitive               | Proposed role                                         | Lifetime/state model                              |
| ----------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| `WorkerEntrypoint`      | Compilation entrypoint or trusted platform service    | Invocation-scoped service instance                |
| `RpcTarget`             | Narrow session handle, callback, or scoped capability | Referenced object with explicit RPC lifetime      |
| Facet / `DurableObject` | Live composer plus recoverable application state      | Actor with durable storage; memory is rebuildable |

`WorkerEntrypoint` exposes public RPC methods and receives a new instance for each invocation. Class
objects passed or returned through RPC must extend `RpcTarget`. Plain snapshots should remain plain
data.
[Service RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/),
[RPC class instances](https://developers.cloudflare.com/workers/runtime-apis/rpc/#class-instances).

RPC references have ownership rules: dispose returned stubs with `using` or `Symbol.dispose`;
argument stubs are disposed when a call returns unless duplicated. Exchanging references can extend
an RPC context, but caller disconnection can cancel it. `dup()` retains a handle, not durable state.
`RpcTarget` supports a synchronous `Symbol.dispose` hook, not `Symbol.asyncDispose`.
[RPC lifecycle source](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/workers/runtime-apis/rpc/lifecycle.mdx).

Use private fields for implementation details: public methods/getters are part of the RPC surface.
Keep authorization in the service implementation even when the caller holds a capability.
[RPC visibility/security](https://developers.cloudflare.com/workers/runtime-apis/rpc/visibility/).

An appealing preview API is `openPreview(input) → PreviewSession extends RpcTarget`, followed by
`update()`, `snapshot()`, and explicit `close()`. This can support a bounded connected editing
session. It should not become the persistence mechanism for a live show. An explicit async `close()`
can dispose the composer; the synchronous disposer should only perform synchronous cleanup and must
not be relied upon to persist state.

### Capabilities and outbound access

Custom bindings can be trusted `WorkerEntrypoint` service references configured with
platform-selected `ctx.props`. The generated Worker calls methods while the trusted implementation
controls tenant scope and credentials. Wrap resources such as R2/D1/KV rather than handing generated
code broad access. [Bindings](https://developers.cloudflare.com/dynamic-workers/usage/bindings/).

Set `globalOutbound: null` explicitly. Otherwise a dynamic Worker inherits its parent's network
access by default. A custom outbound service can intercept `fetch()`/`connect()` if HTTP
compatibility is necessary.
[Egress control](https://developers.cloudflare.com/dynamic-workers/usage/egress-control/).

My default API would expose operations such as `readShowData()`, `readApprovedAsset(assetId)`, and
`requestIntegrationData(integrationId, query)`. Tenant/project context comes from authenticated
platform routing, not arguments provided by generated code. Credentials stay inside the trusted
service. Every method validates payload size, scope, rate, and revocation.

Keep per-invocation objects out of the cached loader configuration. Stable scoped service
configuration belongs in the artifact/config identity; changing input and temporary `RpcTarget`
capabilities travel through invocation arguments with deliberately managed lifetimes. Do not put a
request ID or newly generated signed URL into `WorkerCode` under an unchanged loader ID.

### Workers for Platforms is a different option

Workers for Platforms deploys user Workers into a dispatch namespace through Cloudflare's API, then
invokes them through a dispatch Worker. Dynamic Workers instead load code at runtime. Both permit a
platform routing layer; they are different code-distribution models.
[Workers for Platforms architecture](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/how-workers-for-platforms-works/).

For frequently regenerated Vignette compositions, I would begin with Dynamic Workers and immutable
artifacts. Evaluate Workers for Platforms if customers need separately deployed full applications
and their associated deployment management. Do not choose it solely because the product is a SaaS.

## Proposed platform architecture

The trusted platform owns authentication, artifact selection, show identity, publication, stream
sequencing, asset policy, and quotas. Generated code owns only the permitted authoring/application
logic inside its sandbox.

```text
LLM / editor
   -> source validation -> isolated build job -> immutable artifacts in R2
                                           -> staging compile/diagnostics
                                           -> publish approved version

operator / webhook -> authenticated platform Worker
                         -> composition supervisor DO (tenant/project/session)
                              -> Dynamic Worker facet: React + Yoga composer
                              -> durable show state / publication metadata
                              -> validated setup/update/event stream
                                   -> DOM target
                                   -> local OBS target runtime

browser / OBS frame request -> frame origin -> sandboxed SSR or built document
frame data request          -> scoped, read-only store feed
```

### Ownership of data

| Data                                                                 | Owner/location                   | Recovery rule                                 |
| -------------------------------------------------------------------- | -------------------------------- | --------------------------------------------- |
| Source files, dependency lock, build diagnostics                     | Build service and artifact store | Immutable, attributed to version              |
| Server modules, Yoga binary, browser bundles, frame metadata         | Content-addressed artifacts      | Fetch by exact hash                           |
| Tenant membership and permissions                                    | Trusted control plane            | Never stored only in generated code           |
| Published version, stream counter, last valid snapshot, event outbox | Supervisor storage               | Authoritative across restarts                 |
| Platform-defined show state                                          | Supervisor storage               | Rehydrate generated actor from explicit input |
| Optional generated application state                                 | Facet storage                    | Versioned schema; migration policy required   |
| React graph, reconciler, Yoga heap, subscriptions                    | Facet memory                     | Recreate at boot                              |
| OBS credentials and transport                                        | Local target process             | Never exposed to composition code             |

Prefer supervisor-owned show state in the first release: the generated code receives a typed
serializable input and returns structure. Offer facet-private state only for applications that
actually need custom reducers or autonomous logic. This makes rollback much easier.

### Two execution profiles

**Profile A: reconstructable structure.** Invoke a dynamic `compile(input)` method, create a
composer, render from the input, return a snapshot, and dispose. The supervisor owns state and the
stream. A frame-only title change bypasses compilation entirely. Structural edits invoke compilation
again. This is the simplest first implementation for an LLM composition builder.

**Profile B: stateful live composition.** A platform-authored `CompositionActor` wrapper runs inside
a facet and owns one composer per actor boot. It restores serializable state, creates the root,
renders once, and processes validated application commands. External-store changes can drive React
commits; `root.settled()` supplies read-your-writes when needed. Persist state incrementally and
recreate the root after restart.

Profile B better preserves arbitrary existing live composition behavior, but needs a stricter
generated-code contract. Do not promise persistence of arbitrary `useState`, effect subscriptions,
or timers. Require recoverable values to live in the approved state model. Durable Objects can
restart and discard memory; shutdown hooks are not provided.
[DO lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/).

For v1, prohibit autonomous background structural updates. Each bounded `apply(command)` returns its
compiled result to the supervisor. This avoids an indefinitely running internal stream pump. If
autonomous updates become a requirement, design an explicit reconnectable internal channel with
generation fencing and backpressure; prove its behavior across supervisor/facet restarts before
enabling it.

### A loader/facet sketch

This is API-shaped pseudocode, not a runnable patch. `readApprovedArtifact` is a trusted artifact
reader; the artifact must include a **named** `CompositionActor` export and all required module
bytes.

```ts
// Inside the trusted supervisor Durable Object.
async function getComposerFacet(publication) {
  return this.ctx.facets.get("composer", async () => {
    const artifact = await readApprovedArtifact(publication.artifactHash);
    const worker = this.env.LOADER.get(publication.loaderId, async () => ({
      compatibilityDate: artifact.compatibilityDate,
      compatibilityFlags: artifact.compatibilityFlags,
      mainModule: artifact.mainModule,
      modules: artifact.modules,
      globalOutbound: null,
      env: {}, // Add only stable, approved scoped service bindings.
    }));
    return { class: worker.getDurableObjectClass("CompositionActor") };
  });
}
```

The supervisor must fence publication changes around asynchronous work; the sketch intentionally
omits that transaction/state machine. On upgrade, switch the durable publication record through a
controlled transition, stop old work, and acquire fresh facet stubs. Requests carrying an obsolete
publication generation must never publish results.

The wrapper runs in the same sandbox as the generated module. It improves ergonomics and
correctness, but the trusted supervisor must still treat its results as untrusted. Generated code
must not be able to declare a different managed project ID or grant itself source extensions.

## Build pipeline: the largest engineering task

Worker Loader consumes executable modules. It does not perform the existing Vite plugin's frame
discovery, metadata injection, hydration entry generation, or asset manifest generation.

### Build an artifact, then load it

Use a controlled Node build environment initially, with the existing Vignette/Vite transforms where
appropriate, then adapt its output into Worker Loader modules. A dedicated build adapter must
collect every server chunk and Wasm file; a Wrangler deployment directory is not automatically the
correct loader payload.

The build job should:

1. Accept a restricted source tree and a platform-owned package manifest/lockfile.
2. Allow only pinned Vignette, React, and approved extension packages. Disable user lifecycle
   scripts; never execute user Vite configuration in a privileged builder.
3. Typecheck against the exact supported SDK and capability declarations.
4. Generate frame metadata, browser hydration entries, CSS, fonts, and content-addressed assets.
5. Bundle server code using `workerd` package export conditions; preserve `cloudflare:workers` as a
   runtime import.
6. Include Yoga as a Wasm module, not a JS string, base64 runtime compiler, or browser asset.
7. Emit an artifact manifest with module names/types/hashes, compatibility settings, SDK version,
   extension allowlist, frame registry, and Vignette asset manifest.
8. Store the complete immutable artifact before staging/publication can reference it.

Treat the build environment as another untrusted execution boundary. Package resolution/transforms
should be platform controlled; any tool that executes generated modules runs in a separate
constrained process or sandbox without production credentials.

### Runtime bundling is promising, but not the first dependency

Cloudflare's `@cloudflare/worker-bundler` supports runtime bundling, npm resolution, JSX, export
conditions, virtual modules, and separate browser assets. However, its current README marks it
experimental and not recommended for production. It runs in `workerd`, not plain Node. Its listed
limitations include flat dependency resolution and skipping binary npm files, including `.wasm`. The
README also retains an outdated closed-beta description; current product docs establish open beta.
[Current bundler source](https://github.com/cloudflare/agents/blob/main/packages/worker-bundler/README.md).

For Vignette this means a naive “send TSX plus npm dependencies to `createWorker()`” can lose the
vendored Yoga binary and cannot reproduce frame transforms automatically. My inference: a production
runtime bundler would need an explicit binary/transform adapter and pinned SDK inputs. Validate it
separately against the existing controlled build pipeline.

A later optimization is to prebuild a platform SDK module set and transform only generated authoring
files. Ensure the component and reconciler share one React instance **within the dynamic isolate**,
and benchmark total module parsing/startup. Do not mistake this for permission to import generated
components into the supervisor.

### Wasm packaging

The current DX source already uses `createYogaWasmLayoutEngine()` with a precompiled module. The
dynamic artifact should preserve that contract; the loader can represent a Wasm module as
`{ wasm: ArrayBuffer }`. Match its import name exactly to the server bundle. This is a packaging
change, not a reason to add another layout engine.
[Loader module types](https://developers.cloudflare.com/dynamic-workers/api-reference/).

Do one focused compatibility spike: color background, Yoga-positioned layer, then a transformed
frame and hydration assets. A successful hello-world Worker does not establish that React
scheduling, Yoga initialization, frame SSR, and module splitting all work together in a dynamically
loaded facet.

## Multi-tenancy, identity, and URLs

Replace `COMPOSITION.getByName("default")` with a platform-derived key containing tenant, project,
and session. Keep preview sessions separate from the published session. A user-provided project name
must not select another tenant's DO.

Choose a platform-owned Vignette project ID, stable across published code versions. The CLI's
`--project` must match it. Code hash identifies the version; it should not become the OBS namespace,
or publishing would create a different set of managed resources.

Snapshot/frame paths currently begin with `/`. Simply placing the SaaS under `/tenant/acme/...` does
not prefix `/__vignette/frame/...` or `/assets/...`. Prefer a project/session-specific hostname,
with edge routing choosing the session and immutable frame/artifact version. Alternatively, build an
explicit host adapter for route rewriting; changing only the stream endpoint is insufficient.

Separate three access classes: authenticated operator controls, read-only target stream, and
read-only frame/store access. Browser EventSource and OBS browser sources need a deliberate
authentication design. Use narrowly scoped, revocable read credentials; if URL credentials are
required, redact logs, use a strict referrer policy, and keep them short lived. Never use an
operator session token for frames.

## Generated frames require a second sandbox

The composer sandbox protects the Cloudflare host. A generated frame's hydration bundle executes in
a browser, including OBS's embedded browser. A same-origin frame can interact with platform-origin
resources regardless of `globalOutbound: null` on the composer.

My first release would permit only trusted frame templates plus generated parameters/layout. For
arbitrary generated frames:

- Serve them on a separate origin with no operator cookies or privileged application APIs; avoid
  broad parent-domain cookies.
- Run generated SSR in its own Dynamic Worker, or generate static HTML through isolated build
  execution. Keep stateless frame requests independent of waking the live composer.
- Apply CSP that restricts scripts, connections, images, media, navigation, and framing to the
  product's requirements. Do not allow arbitrary network access simply because the server composer
  is blocked.
- Use iframe sandbox controls where the DOM target supports them; separately verify OBS behavior
  because a browser source is not the same embedding arrangement.
- Expose only the approved read-only store projection. That is especially important for generated
  frames that should not see backstage notes or tenant metadata.

The current `View` emits a root-relative frame URL, and `renderFrameHtml` emits root-relative
hydration paths. A separate frame origin therefore needs a real host integration: a trusted
wrapper/proxy document or an explicit, typed frame-origin routing seam. Document how the
separate-origin frame reaches its store feed, including CORS/read credentials. Do not assume a
target's default base URL solves all of these paths.

Pin frame documents and hydration assets to the same immutable build. Ordinary title/score changes
keep the frame URL stable. A code publication intentionally changes frame code and may reload it;
stage that transition separately from data updates.

## Stream recovery, upgrades, and commands

### Persist publication-level revisions

The current composer starts its revision counter again when recreated. Both target implementations
reject lower snapshot revisions. A reconnecting target can therefore retain revision 100 and ignore
a restarted root's revision 1, even after setup.

Have the supervisor assign a **persisted monotonic stream revision** to each accepted structural
snapshot. The root's local commit revision stays internal. Validate and clone its result into a
boundary snapshot with the supervisor revision before publishing. Preserve this counter across
restarts and rollbacks. An old facet generation cannot allocate or publish a new revision.

Persist the latest valid setup/snapshot pair together with its publication identity. Reconnects
receive setup, then the latest accepted snapshot, then live updates. Subscribe and capture replay
state through one ordered supervisor operation so a concurrent update cannot fall between replay and
subscription. Avoid changing core's message union just to carry SaaS metadata; keep that in the
host's publication record unless a general protocol need emerges.

### Keep desired state separate from commands

`StreamHub` replays state, not one-shot events. That is correct for a fresh target, but insufficient
for reliable timed cues while disconnected. If the SaaS promises cue delivery, add a bounded durable
command outbox, stable event IDs, target acknowledgements, and deduplication. Delivery guarantees
need explicit semantics: retries plus deduplication can provide effectively-once handling for a
defined target session; the existing SSE feed alone cannot establish it.

Prefer durable desired state for recoverable choices, such as which scene should currently be
selected. Keep a “play this stinger now” command distinct. Do not replay transient effects blindly
on reconnect.

### Publication and rollback procedure

1. Build an immutable version and check it in a staging session against approved inputs and
   extension support.
2. Serialize the live supervisor's publication transition. Persist a transition/generation marker
   and pause conflicting mutations.
3. Fence old outputs, preserve the last valid snapshot, and explicitly snapshot/validate state
   needed by the candidate.
4. Stop the old facet and start the new version under the selected state policy. Validate the first
   result before making it public.
5. Commit the new published version and setup/snapshot, allocate the next stream revision, resume
   controls, and notify clients through the normal feeds.
6. On failure, start the prior code against compatible state and retain/reissue the last valid
   output with correct sequencing.

State migration is the difficult part. Reusing the same facet storage is suitable only with
backwards-compatible migrations. For arbitrary generated schemas, use versioned staging facets/state
exports and an explicit migration contract. Rolling code back does not reverse destructive database
changes. Initially disallow generated destructive migrations and keep canonical show state in the
supervisor.

## Resource controls, observability, and cost

Cloudflare currently documents four distinct in-flight Dynamic Workers per ordinary Worker request
and ten across a Durable Object's shared I/O context. Multiple requests to the same dynamic Worker
count once. A large number of defined facets does not imply unlimited concurrent active code.
[Concurrency limits](https://developers.cloudflare.com/dynamic-workers/platform/limits/).

Custom limits include CPU milliseconds and subrequests per invocation, configured on `WorkerCode` or
`getEntrypoint`; the lower limit wins. Hitting a limit throws. The reviewed facet startup options do
not document an equivalent per-call override, so verify how limits apply to facet execution before
relying on them for hostile generated live code.
[Custom limits](https://developers.cloudflare.com/dynamic-workers/usage/limits/),
[facet API](https://developers.cloudflare.com/dynamic-workers/usage/durable-object-facets/).

My platform controls would also cap builds, source/module bytes, graph size/depth, asset bytes,
structural update frequency, live sessions, and subscriber queue size. Reject excessive source/layer
counts before expensive layout. Validate outbound asset/browser URLs separately: a snapshot can
cause a target to fetch even when the composer has no network access.

The existing composer `StreamHub` queues messages per subscriber; it has no documented queue bound.
Add host-level backpressure/disconnect policy. Structural snapshots may be coalesced to the latest
desired state; setup ordering and reliable commands need their own handling. Limit subscribers and
slow-reader retention.

Attach platform-controlled tails with artifact/session attribution, and record
build/load/compile/publish timings, restart counts, errors, asset misses, and stream lag. Tail
events arrive after the dynamic invocation completes, so do not use them as the only status channel
for a long-lived stream.
[Observability](https://developers.cloudflare.com/dynamic-workers/usage/observability/).

Keep build errors, composer diagnostics, persisted control acknowledgements, and target convergence
errors visibly distinct. A successful server mutation does not prove OBS applied it. Source maps
should be retained in artifacts; runtime stack mapping should be verified rather than assumed from
ordinary Wrangler deployments.

### Current pricing implications

Dynamic Workers require Workers Paid. Published rates include 1,000 creations per month; additional
unique Worker/day creations cost **$0.002**. The same code/ID repeatedly invoked counts once per
day; `load()` counts each invocation. Requests use Workers rates: 10 million included, then
$0.30/million; CPU: 30 million milliseconds included, then $0.02/million. Startup CPU is billed too.
Returned `RpcTarget` stubs share the initiating RPC session rather than adding a request for every
subsequent stub call.
[Dynamic Workers pricing](https://developers.cloudflare.com/dynamic-workers/pricing/).

Illustration: 1,000 distinct loader identities active every day for 30 days implies 30,000
Worker/day creations; after the stated allowance, that component is approximately **$58/month**.
Creating a fresh Worker for 100,000 invocations/day would imply about **$5,998/month** for creations
alone. These examples exclude plan fees, other usage, and facet billing behavior, which should be
measured.

Long-lived SSE sessions can keep DO work active. Hibernatable WebSockets are worth evaluating for
idle connection-heavy shows, but require a host transport adapter and target stream client changes;
do not silently replace the starter's feeds. Model DO duration/storage, R2, build compute, assets,
LLM inference, and bandwidth separately.
[DO lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/),
[DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

## Implementation sequence

### 1. Prove dynamic execution without changing targets

Add a separate Cloudflare host/spike around the existing public contracts. Load an immutable
prebuilt artifact; compile a minimal composition, then exercise Yoga and one trusted frame.
Establish module packaging, runtime scheduling, error propagation, and measured cold/warm behavior.
Keep the default production target interfaces unchanged.

### 2. Ship a constrained generated-composition product

Generate source against pinned authoring types or use a validated declarative scene format for
simple layouts. Use Profile A, supervisor-owned show state, trusted frames, no generic network, and
no generated extensions. Add tenant/session routing, staged publication, stream revisions, asset
authorization, and diagnostics. Provide the LLM the SDK vocabulary, stable ID rules, supported
layout surface, and target compatibility constraints.

### 3. Add stateful composition actors

Introduce the platform-authored facet wrapper and explicit state/command schema. Implement recovery,
fenced upgrades, retained last valid output, and bounded subscribers. Confirm the exact limits and
failure behavior in deployed workerd. Keep title/score updates on the existing store feed when
structure is unchanged.

### 4. Add arbitrary frame code and integrations

Implement the frame origin/SSR isolation boundary, approved browser capabilities, narrowly scoped
integrations, versioned frame routing, and event delivery guarantees appropriate to the product.
Evaluate runtime bundling only after binary handling and frame transforms match the controlled
builder.

### Repository placement

Keep Cloudflare bindings, supervisor/facet wrappers, persistence, builds, routing, and quotas in a
Cloudflare host package or the starter/platform application. `core` stays target-neutral; `react`
remains local authoring and compilation; targets keep consuming snapshots. Potential general library
work is limited to justified seams such as revision assignment/restart semantics, configurable frame
hosting, and bounded stream subscription behavior. Do not import Cloudflare protocol objects into
core or make production depend on testkit.

## Proof points before production

These are acceptance checks for a future implementation, not claims that this research implemented
it:

| Scenario                                             | Required observable result                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| Supervisor/facet restart at stream revision 100      | Target accepts the next recovered update; no revision regression          |
| Publish while an old compilation is in flight        | Old-generation result cannot become program output                        |
| Invalid or resource-exhausting generated composition | Last valid program remains; actionable error; no cross-session corruption |
| Malicious tenant ID / asset key / browser URL        | Platform rejects unauthorized access, including target-triggered fetches  |
| Title change with two connected frames               | Both update; frame documents and composition structure stay stable        |
| Reconnect during a publication                       | Consistent setup/assets/snapshot from the selected version                |
| Slow or abandoned stream reader                      | Memory remains bounded and cleanup occurs                                 |
| Rollback following schema change                     | Compatible state restored or transition explicitly rejected               |
| Generated frame attempts privileged access           | No operator credentials/control capability available                      |
| OBS runtime disconnects during a cue                 | Behavior matches documented replay/acknowledgement semantics              |

Research validation: the DX repository's required install, build, typecheck, existing unit tests,
lint, and format check passed before report creation (**36 files / 138 tests**). The report itself
receives a final formatting check. No new test files were created. No browser control, starter smoke
tests, OBS interaction, deployment, or live Cloudflare execution was performed; source/build checks
do not establish browser or production compatibility.

## Decisions still requiring a compatibility spike

- Exact resource-limit enforcement and billing attribution for generated facet methods, including
  code-triggered work.
- Loader module packaging for the complete Vignette/React/Yoga bundle and build-time frame metadata.
- RPC/stream lifecycle behavior across facet abort, supervisor restart, client disconnect, and slow
  readers.
- Frame security and authenticated read-only feeds in both a normal browser and OBS's embedded
  browser.
- The current API maturity and source-map behavior on the target account/runtime/tool versions.

The practical end state is one normally deployed platform host serving many immutable composition
versions, each with a clearly scoped live session. Dynamic Workers supply code isolation, facets
supply optional actor/storage identity, RPC supplies controlled capabilities, and Vignette continues
supplying the composer/stream/target contract.
