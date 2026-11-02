# @vignette/moq

A Media over QUIC source kind for Vignette, and the reference for writing your own (README §7). One
definition, one plugin per target, each in its own entry so a show never bundles code for a target
it does not run.

| Entry                 | Export    | Use                                                                 |
| --------------------- | --------- | ------------------------------------------------------------------- |
| `@vignette/moq`       | `Moq`     | the source component, in a show                                     |
| `@vignette/moq/react` | `MoqView` | `<Stream sources={[MoqView]}>`                                      |
| `@vignette/moq/dom`   | `moqDom`  | `domTarget(element, { sources: [moqDom] })`                         |
| `@vignette/moq/obs`   | `moqObs`  | `obsTarget({ sources: [moqObs] })`, or `--source @vignette/moq/obs` |

```tsx
import { Layer, Scene, Show, Use } from "vignette";
import { Moq } from "@vignette/moq";

export default (
  <Show id="demo" canvas={{ width: 1920, height: 1080 }}>
    <Moq
      id="camera"
      url="https://cdn.moq.dev/demo"
      broadcast="bbb.hang"
      size={{ width: 1280, height: 720 }}
    />
    <Scene id="main">
      <Layer style={{ flex: 1 }} fit="cover">
        <Use source="camera" />
      </Layer>
    </Scene>
  </Show>
);
```

Props: `url`, `broadcast`, `size` (the broadcast's resolution, used for `fit`), `latencyMs` (default
100), and optional `video`, `audio`, `quality` (`auto` or a rendition name) and `disableWhenHidden`.

The React and DOM plugins render `@moq/watch`'s `<moq-watch>`, loaded on first use.

The OBS plugin creates the native `moq_source` input when the connected OBS has the MoQ plugin. Any
other OBS gets a stock media source playing RTMP from a [`moq` CLI](https://github.com/moq-dev/moq)
relay that the plugin runs on a free local port for the source's lifetime:
`moq --connect <url> --broadcast <broadcast> export rtmp --listen <port>`. Install `moq` (moq-cli
0.14 or later; prebuilt binaries are on its GitHub releases) on the machine running `vignette obs`,
or point `VIGNETTE_MOQ_CLI` at it. `latencyMs` becomes `--max-age`, a `quality` other than `auto`
becomes `--video-name`, `audio: false` mutes the input, and `disableWhenHidden` closes the stream
while the source is off air. A media source always shows the video track, so `video: false` applies
only to the native input. Without `moq` the source reports an error and the rest of the scene
converges.
