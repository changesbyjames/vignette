# Cross-target compatibility contract

What the React client, the DOM target and the OBS target render the same, and what they do not. The
authoring side is in [README §2](../README.md#2-making-a-show).

## The same everywhere

- One canvas coordinate system; Yoga computes every layer's frame once, in the composer. No target
  lays out the scene itself.
- Bottom-to-top order, `visible`, `rotation`, `crop`, `align`, and `fit` (`cover`, `contain`,
  `stretch`) computed from each source's `size`. For a source whose picture really is that size,
  every target draws the same.
- Identity by ID: the same source ID keeps its page, playback and connection; a new ID is a new
  thing (README §2, "Identity").
- Shared sources are one live instance across scene switches in every target.
- Frames receive the same validated params. Every target shows a frame as `frames.html` in an iframe
  (OBS: a browser source); the page follows the stream for its params, so a params change never
  reloads the page. A new frame bundle build (`compose({ frameBuild })`) changes the page URL's
  `v=`, which reloads only the frame pages. Clients bundle no frame components and know nothing
  about the show.

## Built-in kinds

| Kind      | React / DOM                                   | OBS                                          |
| --------- | --------------------------------------------- | -------------------------------------------- |
| `color`   | filled `<div>`                                | `color_source_v3`                            |
| `image`   | `<img>` of the downloaded asset (object URL)  | `image_source` of the cached file            |
| `video`   | `<video>`; `loop`, `restartOnShow`            | `ffmpeg_source`; same props, `media:restart` |
| `audio`   | `<audio>`, not laid out                       | `ffmpeg_source` item outside the canvas      |
| `browser` | sandboxed `<iframe>` at the source's viewport | `browser_source` at the laid-out size        |
| `frame`   | `<iframe>` of the frame page                  | `browser_source` of the frame page           |
| `text`    | styled `<div>`; `font` as an `@font-face`     | `browser_source` of a local page it writes   |

OBS browser sources get transparent-body CSS. The browser targets cannot inject CSS into a
cross-origin page, so a page meant for both must make its own background transparent.

## Differences

- **Fit of a picture that is not its declared size.** OBS fits a `cover` or `contain` layer with no
  `crop` by the source's real picture size (OBS bounds; `cover` needs OBS 30.2, obs-websocket 5.5.0,
  or later), so a camera that sends another resolution than its `size` is still fitted right. The
  browser targets, and OBS for a cropped layer, a layer the canvas cuts, a rotated `contain` and
  `cover` on an older OBS, scale from the declared `size`.
- **Opacity** applies in React and the DOM; OBS scene items have no opacity, so OBS ignores it.
- **Audio** follows placement everywhere: a source is heard only while the shown scene places it
  with a visible layer (or lists it, for a source with no picture). Each target reports what of a
  channel it cannot apply in `status.audio.unsupported`: OBS cannot set `mono` or limit the master
  bus; browsers cannot reach the sound of a `Browser` or `Frame` iframe or of `<moq-watch>`, have no
  `noise-gate`, `noise-suppression` or `monitor`, approximate `limiter`, and ignore `tracks`. A
  negative `syncOffsetMs` delays the picture: natively in OBS, through a held-frame delay line in
  browsers. Browsers play sound only after a user gesture (`status.audio.state` is `blocked` until
  then).
- **Shared sources in browsers** move between stages with `Element.moveBefore`. Without it (Safari,
  Firefox at the time of writing) the fallback reloads a moved `<iframe>`; OBS is unaffected.
- **Inline sources in React** stay mounted across scene switches in a `<Stage>` that follows
  `activeScene` (it renders every scene and hides the inactive ones, like the DOM target). A
  `<Stage scene="…">` renders only its scene, so pointing it at another scene remounts them.
- **One placement per scene**: placing one shared source twice in a scene is `DUPLICATE_PLACEMENT`,
  because an OBS scene item is identified by its scene and input.
- **Unknown kinds** fail the revision that uses them with `missing source plugin for kind "…"`
  before any of its sources is created or rendered, unless the target was created with
  `checkPlugins: false` (the dev and `preview` pages), which marks only the sources of that kind
  `error`. A plugin whose `create` rejects marks only that source `error`.

## Not guaranteed

Font metrics and text layout inside pages, frame-accurate video sync, identical paint or color
management, identical filter sound (each target has its own DSP), transitions and video filters, and
adoption of manual edits to managed OBS resources.
