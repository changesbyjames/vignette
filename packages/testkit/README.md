# @strangecyan/vignette-testkit

Deterministic test utilities for Vignette packages and extensions. Production packages must not
depend on this package.

## Install

```sh
pnpm add -D @strangecyan/vignette-testkit
```

`FakeRenderTarget` records setup, snapshot, event, and disposal behavior. `FakeObsTransport` scripts
OBS requests, responses, failures, events, and disconnects without a real OBS process. `ManualClock`
drives retry and scheduler tests deterministically.

Use `applyFakeObsPlan` to apply planner operations to semantic fake OBS state. Validate generated
plans with `validateObsPhaseOrder` and `validateManagedOnlyPlan`; `obsOperationKinds` is useful for
focused assertions. These fakes test contracts and planning behavior, not protocol compatibility,
plugin installation, or real OBS integration.
