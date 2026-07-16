# Plan 006: Implement asynchronous OBS convergence and recovery

> **Executor instructions**: Implement transport and scheduling around the pure
> planner from Plan 005. Do not duplicate planning decisions inside the executor.
> Never test against a user's real production scene collection. Update the plan
> index only after all fake-transport tests pass.
>
> **Drift check (run first)**:
> `git diff --stat HEAD -- packages/target-obs packages/testkit`

## Status

- **Priority**: P1
- **Effort**: L (five to eight days)
- **Risk**: HIGH — reconnect, partial failure, and stale deletion affect remote state
- **Depends on**: `plans/005-obs-model-and-planner.md`
- **Category**: correctness, architecture, tests
- **Planned at**: `unborn main`, 2026-07-15

## Why this matters

React can publish faster than OBS can process requests, requests cannot be truly
cancelled after sending, and a connection can fail after only part of a plan
succeeds. The target therefore needs a revisioned latest-wins state machine that
re-observes and converges rather than replaying assumptions. Keeping this outside
the reconciler prevents remote latency and failure from corrupting React commits.

## Current state

- Plan 005 provides pure normalized state, operations, plans, codecs, fake state,
  and convergence tests.
- `obs-websocket-js@5.0.8` is selected; documentation and types are under
  `reference/obs-websocket-js/`.
- Request batches are ordered but non-transactional. Request status `207`
  (`NotReady`) is retryable after scene-collection changes; session invalidation
  close code must not auto-reconnect.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| OBS target tests | `pnpm --filter @react-obs/target-obs test` | all pass without real OBS |
| Race tests | `pnpm --filter @react-obs/target-obs test -- --run scheduler` | all fake-timer cases pass |
| Full gates | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | all exit 0 |

## Suggested executor toolkit

- Read `reference/obs-websocket-js/README.md` for connect/call/callBatch/events.
- Read protocol sections for `GetVersion`, scene/input/item lists, request batch,
  `CurrentSceneCollectionChanging`, `CurrentSceneCollectionChanged`, and status
  `NotReady` in `reference/obs-websocket/protocol.md`.

## Scope

**In scope**:

- `packages/target-obs/package.json`
- `packages/target-obs/src/transport.ts`
- `packages/target-obs/src/obs-websocket-transport.ts`
- `packages/target-obs/src/bootstrap.ts`
- `packages/target-obs/src/events.ts`
- `packages/target-obs/src/executor.ts`
- `packages/target-obs/src/scheduler.ts`
- `packages/target-obs/src/status-store.ts`
- `packages/target-obs/src/create-obs-target.ts`
- `packages/target-obs/src/errors.ts`
- `packages/target-obs/src/*.test.ts`
- `packages/testkit/src/fake-obs-transport.ts`
- `packages/testkit/src/manual-clock.ts`
- Public exports in both package indexes

**Out of scope**:

- React host config, commands such as restart/seek/transition, multiple scene
  collections, native plugin, persisted duplicate-placement manifest, audio,
  filters, frame-synchronous animation, and automatic program-scene switching.

## Git workflow

- Branch: `codex/006-obs-convergence`.
- Suggested commit: `feat(obs): converge revisions asynchronously`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Define a narrow transport interface and fake

Wrap connect/disconnect, typed single calls, batches, and event subscription in
an internal `ObsTransport` interface. The rest of the package must not depend on
the concrete client. Implement `FakeObsTransport` with scripted responses,
events, disconnect points, delayed calls, partial batches, and a request log that
never records password values.

**Verify**: fake-transport tests simulate success, request failure, partial batch,
disconnect-before-response, and event delivery deterministically.

### Step 2: Bootstrap an authoritative observation

After identification, call `GetVersion`, inspect `availableRequests`, query input
kinds, list canvases/scenes/inputs, and list items for managed scenes only. Build
one normalized observed state stamped with a new connection epoch. Fail preflight
with stable diagnostics when required requests or codecs are unavailable.

Do not issue mutations while bootstrapping. Never query or modify an unrelated
scene's items merely to build the managed index.

**Verify**: bootstrap tests cover empty OBS, existing managed resources, missing
request, missing browser source, another project, and duplicate placement.

### Step 3: Execute plans phase by phase

Translate symbolic operations to concrete typed calls. Resolve UUIDs and numeric
scene-item IDs returned by earlier phases before building later batches. For new
content, preserve disabled -> configure -> transform -> order -> enable. Capture
receipts after every operation and update a shadow state only for confirmed
successes.

Before phases marked destructive, compare the plan revision to the scheduler's
current desired revision. If stale, skip destructive work and request a replan.
On any ambiguous transport failure, discard the shadow state and bootstrap again.

**Verify**: executor tests assert phase request order, symbolic resolution,
stale-delete suppression, receipt updates, and rebootstrap on ambiguous failure.

### Step 4: Implement a mailbox-of-one scheduler

Maintain `desired`, `observed`, `shadow`, `connectionEpoch`, and
`inFlightRevision`. `publish(snapshot)` replaces any older unsent snapshot and
starts one drain loop. Never run two executors concurrently. If a newer revision
arrives during execution, finish only safe in-flight work, skip stale destructive
phases, then plan from the latest credible state to the newest revision.

`whenSettled(revision)` resolves when that revision or a later one is confirmed
applied. It rejects only on terminal target disposal or a non-recoverable target
error, not because the exact revision was superseded.

**Verify**: fake-clock tests publish revisions 1-100 around delayed phases and
assert bounded queue size, no concurrent executor, latest convergence, and older
waiter resolution.

### Step 5: Handle events, collection changes, and reconnects

Use events to update or invalidate shadow state. During
`CurrentSceneCollectionChanging`, pause outgoing work immediately, invalidate all
scene/item IDs, and wait for the changed event before bootstrapping. Treat
`NotReady` as a bounded retry signal with capped exponential backoff plus jitter.

Reconnect transient closes with capped backoff, but never auto-reconnect after
the session-invalidated close code. On every reconnect, increment epoch and
bootstrap. Ensure only one listener exists per event after repeated reconnects.

**Verify**: tests cover collection change mid-plan, `NotReady`, transient close,
session invalidation, event-driven manual edit, and listener cleanup.

### Step 6: Expose target status and lifecycle

Implement statuses `disconnected`, `connecting`, `bootstrapping`,
`synchronising`, `settled`, `paused`, `error`, and `disposed`, each carrying
revision/epoch where applicable. Provide subscribe/getSnapshot semantics without
depending on React. Redact credentials and source settings from default logs.

`dispose()` cancels retry timers, disconnects transport, rejects outstanding
waiters, removes listeners, and makes future publish calls fail synchronously.

**Verify**: lifecycle tests assert the full state sequence, redaction, timer and
listener cleanup, and waiter rejection on disposal.

### Step 7: Implement the concrete client and public factory

Use obs-websocket-js behind `ObsWebSocketTransport`; expose
`createObsTarget({ url, password, projectId, assetResolver, retry, onError })`.
Require password configuration to be passed at runtime; do not read environment
variables inside the library. Export target configuration/status/errors but keep
the raw client private.

**Verify**: compile-time transport contract tests pass and no real socket is
opened by unit tests.

### Step 8: Run full convergence and fault-injection tests

For representative snapshots, inject a failure after every request boundary,
then reconnect/bootstrap/replan and assert final semantic convergence. Assert no
trace contains an operation against an unmanaged UUID or name.

**Verify**: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` -> all pass.

## Test plan

Use only fake transport in required CI tests. Cover rapid revisions, response
delay, every partial-failure boundary, reconnect, scene-collection pause,
manually changed managed transforms, unmanaged coexistence, stale destructive
work, missing capability, redaction, disposal, and settlement semantics. Add an
optional real-OBS probe in Plan 008, not here.

## Done criteria

- [x] Publish never awaits or exposes WebSocket latency to its caller.
- [x] Only one drain/executor runs per target.
- [x] Pending snapshots are bounded to the newest unsent revision.
- [x] Destructive work is skipped when its plan becomes stale.
- [x] Ambiguous failure causes observation and replan, not blind replay.
- [x] Collection changes and reconnects invalidate numeric IDs and epochs.
- [x] Credentials are absent from logs, errors, snapshots, and fixtures.
- [x] Full repository verification passes.
- [x] `plans/README.md` marks Plan 006 `DONE`.

## STOP conditions

- obs-websocket-js cannot represent a required current protocol request safely.
- Any retry path would repeat a one-shot action; one-shot actions are out of
  declarative scope and must not be added here.
- Correct recovery requires scanning or mutating unmanaged scenes.
- A real OBS instance is required to make mandatory unit tests pass.

## Maintenance notes

Every new retry must be reviewed for idempotency. Every new event must state
whether it updates known state or invalidates it. Prefer re-observation over
complex optimistic repair after ambiguous transport failures.

