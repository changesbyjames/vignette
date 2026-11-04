# @strangecyan/vignette-motion

A layer kind for Vignette that animates: `initial`, `animate` and `exit`, as in Motion, on top of
the layer's Yoga layout. One definition, one plugin per target, each in its own entry so a show
never bundles code for a target it does not run.

| Entry                                | Export             | Use                                                |
| ------------------------------------ | ------------------ | -------------------------------------------------- |
| `@strangecyan/vignette-motion`       | `MotionLayer`      | the layer component, in a show                     |
| `@strangecyan/vignette-motion/react` | `motionReactLayer` | `<Stream layers={[motionReactLayer]}>`             |
| `@strangecyan/vignette-motion/dom`   | `motionDomLayer`   | `domTarget(element, { layers: [motionDomLayer] })` |
| `@strangecyan/vignette-motion/obs`   | `motionObsLayer`   | `obsTarget({ layers: [motionObsLayer] })`          |

```tsx
import { Color, Layer, Scene, Show } from "@strangecyan/vignette";
import { MotionLayer } from "@strangecyan/vignette-motion";

export default (
  <Show id="demo" canvas={{ width: 1920, height: 1080 }}>
    <Scene id="main">
      <Layer style={{ position: "absolute", width: "100%", height: "100%" }}>
        <Color color="#111111" />
      </Layer>
      <MotionLayer
        id="lower-third"
        style={{ position: "absolute", left: 80, top: 900, width: 900, height: 120 }}
        initial={{ x: -400, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ y: 160, opacity: 0 }}
        transition={{ type: "spring", visualDuration: 0.45, bounce: 0.2 }}
      >
        <Color color="#f97316" />
      </MotionLayer>
    </Scene>
  </Show>
);
```

A `MotionLayer` is a `Layer`: it takes the same `id`, `style`, `fit`, `align`, `crop`, `opacity`,
`rotation` and `visible`, places one source, and is laid out by Yoga like any other. The motion
props describe how it moves between what Yoga decided and where you want it.

## Rest state and offsets

The layer's laid-out frame, `opacity` and `rotation` are its **rest state**. Motion values are
offsets on top of it, like Motion's transforms on top of CSS layout:

| Value     | Meaning                                     | Default |
| --------- | ------------------------------------------- | ------- |
| `x`, `y`  | pixels right of and below the rest position | `0`     |
| `scale`   | multiplies the rest size about its centre   | `1`     |
| `rotate`  | degrees added to the rest rotation          | `0`     |
| `opacity` | multiplies the rest opacity                 | `1`     |

So `animate={{ x: 0 }}` means "at rest, where Yoga put me", and a layer whose frame changes (a
sibling appeared, the row re-flowed) glides to the new rest state. Yoga keeps owning layout; motion
never moves a layer's siblings.

## The three states

- **`initial`** is where a layer starts when it first appears: it is placed there, then moves to
  `animate`. `initial={false}` starts at `animate` with no enter.
- **`animate`** is where the layer is. Change it on a re-render and the layer moves there from
  wherever it is now, carrying its speed: a retarget mid-flight continues, it never snaps or
  restarts. Omitted, it is the rest state.
- **`exit`** is where the layer goes when it is removed from the show. It plays before the layer's
  source leaves the target. A layer that returns while its exit plays turns around.

Motion runs on the item, so it needs the item's identity to survive re-renders; give a moving layer
an explicit `id` as the Vignette README's identity section advises.

## Transitions

```tsx
transition={{ type: "spring", visualDuration: 0.45, bounce: 0.2 }}   // the default: 0.4, 0.2
transition={{ type: "spring", stiffness: 170, damping: 16, mass: 1 }}
transition={{ type: "tween", duration: 0.5, ease: "easeOut", delay: 0.1 }}
```

Springs are the default because they are interruptible: a spring retargeted mid-flight starts the
new motion with the old one's velocity, so the join is smooth. `visualDuration` is roughly how long
the value takes to first reach its target and `bounce` how much it overshoots (`0` none), as in
Motion and SwiftUI; or give the physics directly. Tweens take a duration, a curve (`linear`,
`easeIn`, `easeOut`, `easeInOut`, `circOut`, `backOut`) and a delay; an interrupted tween carries
its velocity into the next motion too. The same curves play in every target.

`layout` (default `true`) animates changes of the laid-out frame; `layout={false}` snaps to them and
animates only the offsets.

## Registering the plugins

Every target that renders the show needs the kind's plugin, as it needs a source plugin for each
source kind. The setup message lists the layer kinds a show uses, so a target without the plugin
reports `missing source plugin for kind "motion"` before touching anything.

```tsx
<Stream url="/stream" layers={[motionReactLayer]} />; // React
domTarget(element, { layers: [motionDomLayer] }); // DOM
obsTarget({ url, password, layers: [motionObsLayer] }); // OBS
```

The React plugin renders each item as a `motion.div` inside `AnimatePresence`; the DOM plugin
animates the item's box with Motion's `animate()`. Both depend on the `motion` package.

## OBS

OBS has no animation of its own, and animating over the websocket would be paced by the network. The
OBS plugin instead generates a small Lua program per placement and runs it inside OBS, once per
video frame, so motion is locked to OBS's frames: at 60 fps a linear move advances exactly one step
per frame. One script has to be installed by hand, once per OBS:

1. Run the show against OBS once. The plugin writes `loader.lua` into the target's directory
   (`vignette/obs/layers/motion/` under the user's cache directory, `%LOCALAPPDATA%` on Windows,
   `~/Library/Caches` on macOS) and prints its path. Until the loader runs, motion layers are placed
   at rest, so the show still works.
2. In OBS, Tools → Scripts, add that `loader.lua`. OBS keeps it in the scene collection.

From then on the plugin and the loader talk through a mailbox input the plugin creates in the show's
registry scene, `vignette/<show>/motion/mailbox`: one command per revision, acknowledged in the
input's settings. The loader does nothing at rest; it reads the mailbox only when a command arrives
and ticks only the chunks that are moving. Each chunk hands its position and velocity to the next
chunk for the same item, which is what makes a retarget or an interrupted exit continuous.

Two limits come from OBS itself. OBS scene items have no opacity, so `opacity` is applied as a
colour filter on the item's _source_: a shared source placed in several scenes fades in all of them.
And a media source hidden by an exit restarts when shown again, as OBS media sources do.

The Lua is tested without OBS: `@strangecyan/vignette-motion/testing` runs the generated chunks and
the loader in a Lua host (wasmoon) against an in-memory `obslua`, frame by frame, on any platform.
