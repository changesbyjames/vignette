# Custom OBS MoQ source contract

Source repository: `/Users/jameswilliams/Developer/experiments/obs-moqsource`

Inspected revision: `5f0e1ce35d474308c4696abd80149a47f919a237`

The plugin registers one OBS input source with ID `moq_source`. `plugin-main.c` defines the following
settings contract:

| OBS key | Type | Plugin default | Meaning |
|---|---|---:|---|
| `url` | string | `https://cdn.moq.dev/anon` | Relay URL |
| `broadcast` | string | `bbb.hang` | Hang broadcast name |
| `latency_ms` | integer, 0–30000 | 100 | Playout buffer |
| `video` | boolean | true | Subscribe to and output video |
| `audio` | boolean | true | Subscribe to and output audio |
| `quality` | string | `auto` | Automatic or named rendition |
| `disable_when_hidden` | boolean | true | Disconnect while the OBS source is hidden |

The public demo verified by the plugin project is:

```text
URL       https://cdn.moq.dev/demo
Broadcast bbb.hang
Video     1280x720
Audio     44100 Hz stereo
```

The `status` property is plugin-owned diagnostic output and is deliberately not part of declarative
desired settings.

This file records the integration contract only. The plugin repository remains the authoritative
source for implementation, build, lifecycle, and codec details.
