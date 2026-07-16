# @cbj/vignette-target-obs

OBS target for Vignette snapshots. It observes OBS, creates a dependency-aware operation plan, and
converges only resources inside the project's managed namespace. Unmanaged scenes and inputs are
never modified.

## Install

```sh
pnpm add jsr:@cbj/vignette-target-obs jsr:@cbj/vignette-core
```

## Run against OBS

```ts
import { consumeRuntimeMessages, projectId } from "@cbj/vignette-core";
import { OBSRuntime, sseRuntimeSource } from "@cbj/vignette-target-obs";

const runtime = new OBSRuntime({
  projectId: projectId("demo"),
  url: "ws://127.0.0.1:4455",
  password: process.env.OBS_PASSWORD,
  onError: console.error,
});

const controller = new AbortController();
await consumeRuntimeMessages(
  runtime,
  sseRuntimeSource("http://localhost:4173/runtime")(controller.signal),
);
await runtime.dispose();
```

OBS WebSocket must be enabled. `setup()` downloads manifest assets before snapshots are accepted.
Stable snapshots converge through the scheduler; scene-selection events remain one-shot commands.
Use `getStatus()` and `whenSettled(revision)` for observability.

The main entrypoint also exports the pure planner, executor, operation model, naming helpers,
transport interfaces, and codec extension seam. Supply custom `ObsSourceCodec` values through
`extensions`. `createObsTargetWithTransport` and an injected transport are intended for controlled
hosts and tests.
