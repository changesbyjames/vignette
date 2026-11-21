# Plan 016 — Audio as desired state

Status: IN PROGRESS (implemented; live OBS and browser playback checks outstanding)

## Objective

Give every source that carries audio one channel of target-neutral desired state: volume, mute,
balance, mono, sync offset, monitoring, output tracks and an ordered list of filters. Collect the
channels in the snapshot and converge them in each target: obs-websocket's per-input audio
requests and managed filters in OBS, and one Web Audio graph shared by the DOM and React
targets. Add an `<Audio>` source for audio files.

## Decisions

1. **An `audio` prop on the source, not a separate mix tree.** Every audio-capable source
   component accepts `audio`, handled like `id`, and validated by one `AudioChannelSchema` in
   `core`. A shared source is one source, so it has exactly one channel however many layers place
   it. A central definition is ordinary user code (`audio={mix.host}`).
2. **Audio follows placement.** A channel is heard only while an enabled item in the shown scene
   places its source. This is how OBS already behaves (an inactive source is not mixed), and it is
   the rule every target follows. Show-wide music is placed in every scene; OBS keeps an input
   playing across a switch when both scenes contain it. There is no `audible: "always"`.
3. **Mono warns in OBS.** obs-websocket 5 does not expose OBS's downmix flag. The OBS target
   reports `mono` as unsupported for that source and otherwise applies the channel. A native OBS
   plugin is out of scope.
4. **The sync offset is signed, and whichever side is ahead is delayed.** A positive offset
   delays the source's audio; a negative one delays its picture by the difference, because no
   target can play audio early. The range is OBS's own, so OBS needs nothing beyond its native
   request.
5. Backwards compatibility is not a priority: `Video.muted` and `ObsInput.muted` are removed.

## Contract

### Source definitions

`SourceDefinition` gains `media(props) → { audio: boolean; video: boolean }`, defaulting to
`{ audio: false, video: true }`.

| Kind | `audio` | `video` |
|---|---|---|
| `Video` | true | true |
| `Moq` | `props.audio` | `props.video` |
| `Browser`, `Frame` | true | true |
| `Image`, `Color`, `Text` | false | true |
| `Audio` (new) | true | false |

`Moq.audio` keeps meaning "fetch the audio track at all". `<Audio src loop restartOnShow>` is an
asset source like `Video`: it lists `src` in `assets` and answers `media:restart`.

### Channel

```ts
AudioChannel = {
  volumeDb: number;        // default 0, at most +26 (OBS's ceiling); -Infinity is not used, mute is
  muted: boolean;          // default false
  balance: number;         // -1 (left) … 1 (right), default 0
  mono: boolean;           // default false
  syncOffsetMs: number;    // -950 … 20000, OBS's range: positive delays the audio, negative the picture
  monitor: "off" | "monitor-only" | "monitor-and-output";   // default "off"
  tracks: readonly number[];  // OBS output tracks 1–6, default [1]
  filters: readonly AudioFilter[];
}
AudioFilter =
  | { kind: "gain"; id; db }
  | { kind: "compressor"; id; thresholdDb; ratio; attackMs; releaseMs; outputDb }
  | { kind: "limiter"; id; thresholdDb; releaseMs }
  | { kind: "noise-gate"; id; openDb; closeDb; attackMs; holdMs; releaseMs }
  | { kind: "noise-suppression"; id; levelDb }
  | { kind: "eq"; id; lowDb; midDb; highDb }
```

Filter `id`s are stable IDs, unique within the channel; they name the managed OBS filter, so
reordering or editing a filter never replaces it. Ducking (the OBS compressor's sidechain) is a
later addition to the union.

### Snapshot

- `Source.audio?: AudioChannel`: present, with defaults filled in, on every source whose kind's
  `media(props).audio` is true, so a target always has the complete list.
- `Snapshot.mix: { volumeDb; limiter?: { thresholdDb; releaseMs } }`, authored with
  `<Show mix>`.
- `SnapshotScene.audio: readonly StableId[]`: sources with no picture that the scene places. They
  are not items.

### Authoring diagnostics

- `audio` on a source whose kind has no audio: `AUDIO_UNSUPPORTED`, error.
- Duplicate filter IDs in one channel: `INVALID_PROPS`, error.
- `style`, `fit`, `crop`, `opacity` or `rotation` on a layer whose source has no picture:
  warning; they are ignored.

## Target mapping

| Channel field | Web Audio (DOM, React) | OBS |
|---|---|---|
| `volumeDb` + `mix.volumeDb` | strip `GainNode`, master `GainNode` | `SetInputVolume` with the sum (OBS has no master fader) |
| `muted`, placement | strip gain ramps to 0 | `SetInputMute`; placement is OBS's own |
| `balance` | `StereoPannerNode` | `SetInputAudioBalance` (`(balance + 1) / 2`) |
| `mono` | `GainNode` with `channelCount: 1`, `channelCountMode: "explicit"` | unsupported: warning |
| `syncOffsetMs` > 0 | `DelayNode` created with `maxDelayTime` 20 s | `SetInputAudioSyncOffset` |
| `syncOffsetMs` < 0 | the source's picture through the frame delay line (step 4) | `SetInputAudioSyncOffset` (negative) |
| `monitor` | `off` → program output only; `monitor-only` → speakers only; both | `SetInputAudioMonitorType` |
| `tracks` | ignored | `SetInputAudioTracks` |
| `gain` | `GainNode` | `gain_filter` |
| `compressor` | `DynamicsCompressorNode` | `compressor_filter` |
| `limiter` | `DynamicsCompressorNode` (ratio 20, attack 0): approximate | `limiter_filter` |
| `noise-gate` | AudioWorklet | `noise_gate_filter` |
| `noise-suppression` | unsupported: warning (RNNoise worklet later) | `noise_suppress_filter_v2` |
| `eq` | three `BiquadFilterNode`s (low shelf, peaking, high shelf) | `basic_eq_filter` |
| `mix.limiter` | master `DynamicsCompressorNode` | unsupported: warning |
| `Browser` / `Frame` audio | unsupported: a parent page cannot reach iframe audio | `reroute_audio: true` |

Anything a target cannot apply is reported, never silently dropped (see Status).

## Implementation steps

### 1. Core and authoring

1. Add `media` to `SourceDefinition` with its default; declare it on every built-in kind and on
   `Moq`.
2. Add `AudioChannelSchema`, `AudioFilterSchema` and `MixSchema` to `core/snapshot.ts` (or
   `core/audio.ts`), with `z.output` types and readonly data.
3. Accept `audio` on every source component next to `id` (`SourceIdProp` becomes the common
   props), lower it in `react-authoring/lower.ts`, validate it with the kind, and fill defaults.
   Accept `mix` on `<Show>`.
4. In `core/layout/compile.ts`, a layer whose source has `video: false` contributes no Yoga node
   and no item: it adds its source ID to `scene.audio` instead, and skips the non-positive frame
   check. A shared source with no picture placed with `<Use>` behaves the same.
5. Add `Audio` (`core/sources/audio.ts`); remove `Video.muted`.

### 2. OBS: channel settings

1. Replace `ObsInput.muted` with `ObsInput.audio: boolean`. The target, not the plugin, owns the
   channel: plugins only say whether their input carries audio. `browserObs` and `frameObs` set
   `reroute_audio: true`; `videoObs`, `audioObs` and the MoQ plugins set `audio: true`.
2. Place each `scene.audio` source as an enabled scene item with an identity transform.
3. Bootstrap reads `GetInputVolume`, `GetInputAudioBalance`, `GetInputAudioSyncOffset`,
   `GetInputAudioMonitorType` and `GetInputAudioTracks` in the batch that reads `GetInputMute`,
   into `ObservedObsInput.audio`. Each joins `missingRequests` when OBS does not advertise it.
4. The planner gets an `audio` phase after `settings`, generalising `planMute`: one operation per
   field that differs, depending on the input's create. Volume compares in dB with a 0.05 dB
   tolerance, because OBS stores a multiplier.
5. Extend `FakeObs` with the same requests and observed state.

### 3. Web mixer

1. Add `src/web-media/`, browser-only and importable by `dom` and `react` (an `oxlint.config.ts`
   rule: it may not import `obs`, `dom`, `react` or Node built-ins). It holds:
   - `createMixer()`: one `AudioContext`; master gain → optional limiter → a
     `MediaStreamAudioDestinationNode` (`output: MediaStream`, the program mix for WHIP or
     recording) and the context destination (speakers), split by `monitor`.
   - A channel strip per source: input → delay → mono → filters → panner → gain → master.
   - `connect(sourceId, input)`, where input is an `HTMLMediaElement`, a `MediaStream` or an
     `AudioNode`; `apply(channel)`; `gate(sourceId, audible)`; `disconnect(sourceId)`.
   - `state: "running" | "blocked" | "closed"` and `resume()`, because autoplay policy keeps a new
     context suspended until a user gesture.
2. Carry over the livecams `AudioManager` design, fixing:
   - connect a `MediaStream` from `getAudioTracks()` at once, and rebuild on `addtrack` and
     `removetrack`, ignoring video tracks (the livecams `once` listener throws on a video track and
     never connects audio);
   - disconnect every node of a strip, not only its source;
   - ramp with `setTargetAtTime` instead of setting `.value`;
   - create the delay with a 20 s `maxDelayTime` (the default is 1 s);
   - keep settings that arrive before the input and apply them on connect;
   - pause and remove the Chrome WebRTC preload `<audio>` element once the graph plays.
3. **DOM:** the target owns a mixer. `DomHandle.audio?: AudioInput` is read after `create` and
   every `update`. `createSceneRenderer` already knows which sources the shown scene places
   (`shown`); the mixer gates every other channel, which stops parked sources being heard.
4. **React:** `<Stream>` owns a mixer in context; views call `useSourceMedia({ audio })`.
   `SharedSources.placement` and the shown scene's items decide the gate.
5. `videoDom`, `VideoView`, and new `audioDom` and `AudioView` connect their media element.
6. Add `TargetStatus.audio` (see Status) to both targets, and `resume()` to the DOM target and the
   React client.

### 4. Video delay

1. `src/web-media/` gains a frame delay line: it takes a picture (an
   `HTMLVideoElement`, an `HTMLCanvasElement` or a video `MediaStreamTrack`), captures frames as
   `VideoFrame`s (`requestVideoFrameCallback` for video, a canvas's frames each animation frame, a
   `MediaStreamTrackProcessor` for a track), queues them by capture time, and draws the frame
   `delay` ms old into its own canvas. Frames leaving the queue are closed.
2. Plugins hand the target their picture beside their audio input: `DomHandle.video?` in the DOM,
   and the same argument to the React hook (`useSourceMedia({ audio, video })`). While the
   source's offset is negative the target shows the delay line's canvas in place of the plugin's
   element, which stays in the document, hidden, as the audio source. At zero or above it
   tears the line down and shows the element again.
3. The queue starts empty whenever the source becomes shown, restarts (`media:restart`,
   `restartOnShow`) or seeks: the line shows the live frame until it holds `delay` ms, then
   switches, instead of going blank.
4. Sources with a native way take it instead: a future WebRTC (WHEP) source sets
   `RTCRtpReceiver.jitterBufferTarget` on its video receiver. For MoQ, `@moq/watch` drives audio
   and video from one `Sync` clock, so its `delay` moves both; file an upstream request for a
   per-track offset, and use the delay line until then.
5. Held frames cost GPU memory (about 470 MB at 1080p60 for 950 ms, 100 MB at 720p30). Measure it
   in the soak example before documenting the full range for the web.

### 5. MoQ

`@moq/watch` 0.3 decodes into its own `AudioContext` (`audio.out.context`, `audio.out.root`), and
nodes cannot connect across contexts. `moqDom` and `MoqView` connect `root` to a
`MediaStreamAudioDestinationNode` in the element's context, silence the element's own emitter, and
hand the stream to the mixer. File an upstream request to let `<moq-watch>` use a supplied context.

### 6. Managed filters

1. OBS: bootstrap reads `GetSourceFilterList` for each managed input. Managed filters are named
   with the show's namespace and the filter ID (`naming.ts`); others are never touched.
2. The planner creates, updates (`SetSourceFilterSettings`), reorders (`SetSourceFilterIndex`)
   and removes managed filters, in a `filters` phase after `audio`. A managed filter of the wrong
   kind is a problem, like an input of the wrong kind.
3. Web: the strip rebuilds its filter chain when the list's kinds or order change, and otherwise
   sets parameters.
4. The same machinery later gives item opacity in OBS through a managed colour-correction filter;
   that is not part of this plan.

## Status

`TargetStatus.audio?: { state: "running" | "blocked" | "unavailable"; unsupported:
Readonly<Record<string, readonly string[]>> }`. `unsupported` lists, per source ID, the channel
fields or filter IDs this target cannot apply (`mono` in OBS, `noise-suppression` on the web, any
audio on a web `Browser` or `Frame`). OBS reports `running` while connected.

## Testing

Add cases to existing test files only:

- `core/validate.test.ts`, `react-authoring/lower.test.tsx`: defaults, `AUDIO_UNSUPPORTED`,
  duplicate filter IDs.
- `core/layout/compile.test.ts`: an audio-only layer adds to `scene.audio`, takes no space in
  flex layout, and produces no item.
- `obs/planner.test.ts`, `obs/target.test.ts`: each field converges once and is idempotent; mono
  is reported; managed filters are created, reordered and removed without touching an operator's
  filter.
- `dom/target.test.ts`, `react/stream.test.tsx`: a parked source's channel is gated; a channel
  that arrives before its input is applied on connect. Web Audio is faked in the test file.
- `packages/moq/src/dom.test.ts`: the decoder's root is bridged to the mixer.
- `dom/target.test.ts`: a negative offset swaps in the delay line's canvas, a restart empties the
  queue and shows the live frame, and returning to zero restores the element. `VideoFrame` is
  faked in the test file.
- The soak example gains an `<Audio>` bed placed in every scene and a channel with filters, and
  logs `GetInputVolume` per input.

## Acceptance criteria

- One snapshot drives OBS and the web; neither target needs target-specific data in core.
- A source is heard only while the shown scene places it, in every target.
- Changing one channel field produces exactly one OBS request, and none on the next convergence.
- Operator-added OBS filters survive every plan.
- A negative offset delays the picture, not the audio, in every target.
- Every unsupported setting appears in `status.audio.unsupported`.
- The six repository gates pass.

## Stop conditions

- Stop if obs-websocket answers any channel request differently from its documented shape on the
  isolated OBS; record what it does instead.
- Stop if gating parked sources breaks `Video`'s keep-playing-while-hidden behaviour; the picture
  must keep its position, only its sound is gated.
- Do not add settings bags to core to reach a target-specific option; report it as unsupported.

## Implementation notes (2026-11-21)

Implemented on `feat/audio`. Where it departs from the steps above:

- `audio={false}` is the common way to drop a source's sound, so `Moq` lost its own `audio` prop;
  the MoQ plugins fetch audio only for a source with a channel.
- `tracks` defaults to all six, OBS's own default, so a new input with a default channel needs no
  requests.
- `status.audio` is `{ state, unsupported, mix }`; `mix` lists master-bus settings a target
  cannot apply (OBS: `limiter`).
- A pictureless item in OBS is an enabled 1×1 item just outside the canvas, not an identity
  transform: a relayed `<Moq video={false}>` is a media source that would otherwise show its
  video.
- A managed filter whose kind changed is removed and created again rather than reported, since it
  is the show's own.
- Web Audio: `noise-gate` is reported unsupported rather than built as an AudioWorklet; `monitor`
  other than `off` is reported unsupported and plays to the program output; `tracks` is ignored.
  A `Browser` or `Frame` source reports only the channel fields set away from their defaults,
  because its iframe plays as it is.
- Without Web Audio (jsdom, old browsers) the mixer falls back to each media element's `muted` and
  `volume`, and `status.audio.state` is `unavailable`.
- Element inputs stay muted until the `AudioContext` runs, so autoplay policy never stops their
  picture; the mixer resumes the context on the page's first pointer or key press, and the DOM
  target exposes `resume()` and `audioOutput`.
- The obs-websocket requests and filter kinds were checked against obs-websocket's protocol
  documentation and obs-studio's `obs-filters` sources, not yet against a running OBS.

Outstanding: a run against the isolated OBS (stop condition 1), user-observed browser playback
(autoplay, the MoQ bridge, the delay line under real frames), the soak example's `<Audio>` bed,
and an upstream request for `<moq-watch>` to take a supplied `AudioContext` or per-track offset.
