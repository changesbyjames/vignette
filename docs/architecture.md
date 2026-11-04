# Architecture

[`README.md`](../README.md) is the specification; this page maps it onto the code. Plan
[014](../plans/014-vision-refactor.md) records the decisions behind it.

```
show (React) ──▶ composer ──▶ stream ──▶ target (React, DOM, OBS, or yours)
```

## Pieces and where they live

Everything is one package, `packages/vignette` (`@strangecyan/vignette` on npm), split by directory
under `src/`.

| Directory         | Holds                                                                                                      | Entry                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `core`            | snapshot schemas, `defineSource` and the built-in definitions, validation, the Yoga compiler               | `@strangecyan/vignette`                                            |
| `react-authoring` | `<Show>`, `<Scene>`, `<Layer>`, `<Use>`, the reconciler host config, lowering to a show tree               | `@strangecyan/vignette`                                            |
| `compose`         | `compose()`: React root, compile on commit, publish the stream (`machine.ts`)                              | `@strangecyan/vignette`                                            |
| `stream`          | `setup` / `update` / `event` messages, the replaying hub, `toSseEvent`, `fromSse`                          | `@strangecyan/vignette`                                            |
| `target`          | `createTarget`: the kernel every target shares (setup checks, asset stage, plugin lifetime)                | `@strangecyan/vignette`                                            |
| `react`           | `<Stream>`, `<Stage>`, hooks and the built-in React views                                                  | `@strangecyan/vignette/react`                                      |
| `dom`             | `domTarget` and the built-in DOM plugins                                                                   | `@strangecyan/vignette/dom`                                        |
| `obs`             | `obsTarget`: connection and convergence machine, planner, executor, file asset store, built-in OBS plugins | `@strangecyan/vignette/obs`, `@strangecyan/vignette/obs/testing`   |
| `frame`           | `frame()` for shows; `mountFrames`, the frame page's entry (`frames.js` only)                              | `@strangecyan/vignette/frame`, `@strangecyan/vignette/frame/mount` |
| `bundle`          | `bundle()`, `scanAssets`, the `frames.html` template                                                       | `@strangecyan/vignette/bundle`                                     |
| `vite`, `cli`     | the Vite plugin and the `vignette` command                                                                 | `@strangecyan/vignette/vite`, bin                                  |

`packages/moq` (`@strangecyan/vignette-moq`) is a source kind built only on the public plugin
interfaces, the worked example of [README §7](../README.md#7-making-your-own-sources-and-plugins).

## Boundaries

`AGENTS.md` lists the import rules; `oxlint.config.ts` enforces them. In short: `core`, `stream`,
`compose`, `react-authoring` and `target` run anywhere and import no Node, DOM, OBS or bundler code;
`obs` never imports the browser targets and they never import `obs`; `frame`, `bundle`, `vite` and
`cli` sit on top. Clients (`react`, `dom`, the dev and `preview` pages) know nothing about shows,
scenes or frames: they render frames as iframes to the frame page, and `frames.js` is the only
bundle that contains frame components. `vite` and `playwright` are optional peers that only
`bundle`, `vite` and the `dev`, `build` and `preview` commands import, lazily.

## How a commit becomes pixels

1. React commits into an in-memory host tree. Host methods only mutate local nodes
   ([ADR 0001](adr/0001-memory-host.md)).
2. The composer lowers the tree to a show tree (derived IDs, inline vs. shared sources), validates
   props with each kind's zod schema, runs Yoga once ([ADR 0002](adr/0002-yoga-is-canonical.md)),
   and publishes an immutable snapshot. Diagnostics are composer status, never stream payload.
3. The stream replays `setup` and the latest `update` to every new subscriber; `event`s are live
   only.
4. A target's kernel checks it has a plugin for every kind in `setup.kinds`, downloads assets named
   in the manifest (verifying hashes), then creates, updates and disposes one plugin handle per
   source ID and hands the medium the snapshot plus the live handles.
5. The medium converges: React re-renders `<Stage>`, the DOM target patches positioned elements, and
   the OBS machine plans and executes obs-websocket requests until a fresh observation needs no plan
   ([ADR 0003](adr/0003-exclusive-obs-ownership.md)). The promise the medium's `update()` returns
   resolves when it has converged; that is the only "revision settled" signal the kernel uses.

Locations are never derived: the host passes `serve` to `compose`, setup publishes it, and targets
read it from there.

## State machines

The composer (`compose/machine.ts`), the target kernel (`target/kernel-machine.ts`) and the OBS
target (`obs/machine.ts`, one machine with parallel `connection` and `convergence` regions) are
XState v5 machines: `setup({ types, actions, guards, actors }).createMachine(...)`, with async work
as `fromPromise` / `fromCallback` actors, so leaving a state cancels its work. Tests drive them with
`createActor` and fake actors. The SSE client's reconnect (`stream/sse.ts`) is a plain loop with one
phase, reported through `onConnection`.

Status is observable through `status` and `subscribe()` as one `TargetStatus` for every target: the
kernel owns `phase`, `revision`, `assets`, per-source state and `sourceErrors`; a medium with a
connection (OBS's websocket, the React client's SSE) reports it as `connection` through
`CreateTargetOptions.connection(report)`. Target failures never throw into the composer.
