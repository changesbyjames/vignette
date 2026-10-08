# @strangecyan/vignette-moq

Media over QUIC source extension for Vignette. It provides one source model plus separate React,
DOM, and OBS facets so each architecture layer depends only on the contracts it needs.

## Install

```sh
pnpm add @strangecyan/vignette-moq
```

## One source kind, four entrypoints

Every entrypoint implements the same `source:moq` kind (`MOQ_SOURCE_KIND`). They are separate so
each layer depends only on the contracts it needs:

| Entrypoint                        | Export            | Register with                                                                          |
| --------------------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| `@strangecyan/vignette-moq`       | `moqSourceModule` | `defineComposition({ extensions })`                                                    |
| `@strangecyan/vignette-moq/react` | `<MoqSource>`     | use in the composition's component                                                     |
| `@strangecyan/vignette-moq/dom`   | `moqDomRenderer`  | `useStage` / `DOMRuntime` `extensions`                                                 |
| `@strangecyan/vignette-moq/obs`   | `moqObsCodec`     | `OBSRuntime` `extensions`, or `vignette obs --extension @strangecyan/vignette-moq/obs` |

```tsx
import { defineComposition } from "@strangecyan/vignette";
import { moqSourceModule } from "@strangecyan/vignette-moq";
import { MoqSource } from "@strangecyan/vignette-moq/react";

function Show() {
  return (
    <MoqSource
      id="camera"
      url="https://cdn.moq.dev/demo"
      broadcast="bbb.hang"
      size={{ width: 1920, height: 1080 }}
    />
  );
}

export const composition = defineComposition({
  id: "demo",
  canvas: { width: 1920, height: 1080 },
  extensions: [moqSourceModule],
  component: Show,
});
```

```tsx
import { moqDomRenderer } from "@strangecyan/vignette-moq/dom";

useStage({ sceneId: "main", stream, extensions: [moqDomRenderer] });
```

`moqSourceModule` names the `/dom` and `/obs` entrypoints in its `entrypoints` metadata. The
composer advertises `source:moq` in its stream's setup, so a DOM or OBS target that has not
registered the matching facet enters its `error` phase with a message naming the entrypoint to
register. The DOM facet uses `@moq/watch`. The OBS facet requires an installed input plugin exposing
`moq_source`; unsupported capabilities are reported by the target rather than silently emulated.

Latency defaults to 100 ms. Optional `video`, `audio`, `quality`, and `disableWhenHidden` settings
map to both target implementations where supported.

The package carries `MoqSource` explicitly through Vignette's generic extension contracts. It does
not modify core's built-in source types or install global TypeScript declarations.
