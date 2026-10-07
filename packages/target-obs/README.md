# @strangecyan/vignette-target-obs

OBS target for Vignette snapshots. It observes OBS, creates a dependency-aware operation plan, and
converges only resources inside the project's managed namespace. Unmanaged scenes and inputs are
never modified.

## Install

```sh
pnpm add @strangecyan/vignette-target-obs @strangecyan/vignette-core
```

## Run against OBS

```ts
import { consumeRuntimeMessages } from "@strangecyan/vignette-core";
import { OBSRuntime, sseRuntimeSource } from "@strangecyan/vignette-target-obs";

const runtime = new OBSRuntime({
  projectId: "demo",
  url: "ws://127.0.0.1:4455",
  baseUrl: "http://localhost:4173/runtime",
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

Setup is also the safety gate. `projectId` is the namespace boundary: when a stream's setup names a
different project ("Stream is for project 'x' but this OBS runtime manages project 'y'…"), or
advertises an extension source kind with no registered codec ("Stream requires source kind
'source:moq'; register @strangecyan/vignette-moq/obs."), the runtime reports the `error` phase
through `getStatus()` and `onError`, ignores updates and events, and never contacts OBS. The whole
target is blocked rather than individual sources, matching the planner, which already rejects a
revision containing a source it cannot materialize. A later valid setup clears the error. The
scheduler independently rejects any snapshot whose `projectId` differs from its own.

Root-relative snapshot URLs (`/__vignette/frame/...`, `/assets/...`) resolve against `baseUrl`, the
address this process uses to reach the composer. OBS loads browser sources itself; when it reaches
the composer at a different address (for example, a worker in Docker and OBS on the host), set
`browserSourceBaseUrl` as well. Without a base, a root-relative manifest URL fails `setup()` and a
root-relative browser source fails preflight, putting the target into its `error` phase. Stable
snapshots converge through the scheduler; scene-selection events remain one-shot commands. Use
`getStatus()` and `whenSettled(revision)` for observability.

The main entrypoint also exports the pure planner, executor, operation model, naming helpers,
transport interfaces, and codec extension seam. Supply custom `ObsSourceCodec` values through
`extensions`. `createObsTargetWithTransport` and an injected transport are intended for controlled
hosts and tests.
