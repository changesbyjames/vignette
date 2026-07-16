# @cbj/vignette-moq

Media over QUIC source extension for Vignette. It provides one source model plus separate React,
DOM, and OBS facets so each architecture layer depends only on the contracts it needs.

## Install

```sh
pnpm add jsr:@cbj/vignette-moq
```

```tsx
import { moqSourceModule } from "@cbj/vignette-moq";
import { moqDomRenderer } from "@cbj/vignette-moq/dom";
import { moqObsCodec } from "@cbj/vignette-moq/obs";
import { MoqSource } from "@cbj/vignette-moq/react";

const composerExtensions = [moqSourceModule];
const domExtensions = [moqDomRenderer];
const obsExtensions = [moqObsCodec];

<MoqSource
  id="camera"
  url="https://cdn.moq.dev/demo"
  broadcast="bbb.hang"
  size={{ width: 1920, height: 1080 }}
/>;
```

Pass the three extension arrays to the composer root, `DOMRuntime`, and `OBSRuntime` respectively.
The DOM facet uses `@moq/watch`. The OBS facet requires an installed input plugin exposing
`moq_source`; unsupported capabilities are reported by the target rather than silently emulated.

Latency defaults to 100 ms. Optional `video`, `audio`, `quality`, and `disableWhenHidden` settings
map to both target implementations where supported.

This package uses TypeScript module augmentation to add `source:moq` to core's closed `SourceKinds`
map. It is therefore published with JSR's slow-types opt-in. JSR does not generate a separate
`.d.ts` artifact for slow-type packages; TypeScript-source consumers retain the augmentation.
