# Cross-target compatibility contract

## Guaranteed common behavior

For nodes supported by both targets, a compiled revision defines:

- one fixed-resolution canvas coordinate system;
- absolute layer frames and canonical bottom-to-top order;
- contain, cover, and fill content fitting;
- explicit crop and content alignment;
- visibility and leaf rotation;
- clipping inherited from virtual layout containers;
- deterministic target-local diagnostics for unsupported runtime capabilities.

The compiler runs the same pinned Yoga configuration for each target branch. Common nodes produce
the same computed rectangles; DOM and OBS never independently reinterpret flexbox. Native OBS scene
items do not expose opacity through obs-websocket, so non-unit opacity is a diagnosed DOM-only
feature in V1.

## First-release sources

- Static image from a logical project asset.
- Local media file from a logical project asset.
- Browser source with an absolute HTTP(S) URL and declared viewport.
- Solid color source.
- Nested scenes as explicit compositing/reuse boundaries.

Browser sources receive the same default CSS in both targets:
`body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }`. OBS applies it
through the browser input's native custom-CSS setting. The DOM target injects it after each iframe
load when the iframe document is same-origin. Browser same-origin policy prevents injection into an
arbitrary cross-origin URL; in that case the iframe has `data-react-obs-css-injection="blocked"`,
and the served page must include equivalent CSS itself.

Optional `@cbj/react-obs-frame` views compile to this same browser-source contract. The Vite adapter
serves one URL as server-rendered HTML plus React hydration JavaScript; DOM and OBS each load that
URL in their own browser instance, so markup and behavior are shared but hook state and timing are
not synchronized.

The declared browser viewport is the intrinsic coordinate space used by common fit and crop
calculation. Each target renders the page at the layer's realized pixel size. In OBS, the planner
sets the browser input's native width and height to that realized size instead of rendering at the
declared viewport and scaling the finished texture. A reusable browser source cannot have two
different native sizes at once, so OBS diagnoses placements that realize one source ID at
incompatible sizes; use distinct source IDs in that case.

## Explicit non-guarantees

- Font discovery, glyph metrics, line breaking, and native text source parity.
- Frame-accurate video playback synchronization.
- Identical browser-engine paint, GPU output, or color management.
- Audio routing, monitoring, filters, transitions, capture cards, and replay controls.
- Frame-by-frame native animation over WebSocket.
- Adoption of manual changes to managed OBS resources.
- Multiple placements of one source in the same scene in the first release.

## Target-specific content

The common authoring graph has no target-selection primitive. Every source and layer in a compiled
snapshot is offered to every runtime, and an incompatibility is local runtime state rather than a
composer failure or a delayed React exception. Target-native features can be added through separate
runtime control APIs, but they cannot participate in common Yoga flow unless the snapshot contract
gains a target-neutral representation for them.

## Identity and ownership

Every scene, source, and layer that reaches a remote target has an explicit ID. Labels are
presentation only. React keys never become remote IDs. The OBS target owns only names in its project
namespace and overwrites manual changes to those managed resources on its next convergence pass.
