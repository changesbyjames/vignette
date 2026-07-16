<p align="center">
	<img height="128px" src="https://github.com/moq-dev/moq/blob/main/.github/logo.svg" alt="Media over QUIC">
</p>

# @moq/watch

Subscribe to and render Media over QUIC broadcasts, built on top of `@moq/hang` and `@moq/net`.

## Installation

```bash
npm add @moq/watch
```

## Web Component

```html
<script type="module">
  import "@moq/watch/element";
</script>

<moq-watch url="https://relay.example.com/anon" name="room/alice.hang">
  <canvas></canvas>
</moq-watch>
```

### Attributes

| Attribute | Type | Default | Description |
|---|---|---|---|
| `url` | string | required | Relay server URL |
| `name` | string | required | Broadcast name/path |
| `paused` | boolean | false | Pause playback |
| `muted` | boolean | false | Mute audio |
| `visible` | never, distance, or always | `20%` | When to download video |
| `volume` | number | 0.5 | Audio volume from 0 through 1 |
| `reload` | boolean | true | Wait for reannouncement before subscribing |

`visible="never"` prevents video download. A CSS distance such as `0px`, `200px`, or `100%`
downloads near the viewport and suspends while the tab is hidden. `visible="always"` downloads
regardless of element and tab visibility.

The published element also observes `latency`, `latency-min`, and `latency-max`. A numeric
`latency` value is a fixed millisecond target; `real-time` is adaptive.

## JavaScript API

```ts
import * as Watch from "@moq/watch";

const watch = new Watch.Broadcast(connection, {
  enabled: true,
  name: "alice.hang",
  video: { enabled: true },
  audio: { enabled: true },
});
```

The `<moq-watch>` instance exposes its backend. Manual video rendition selection updates
`watch.backend.video.source.target` with a rendition `name`; clearing the name returns to automatic
selection.

## Features

- WebCodecs decoding with MSE fallback.
- Reactive playback state.
- Quality selection across available renditions.
- Optional UI web component with controls and statistics.

## License

The package declares `(MIT OR Apache-2.0)`. See the upstream moq repository for the full license
texts.

> Vendoring note: this is the relevant API material from the published `@moq/watch@0.3.0` README,
> augmented with the latency attributes present in that package's `element.d.ts` but omitted from
> its README table.
