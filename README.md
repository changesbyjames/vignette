# Vignette

Describe a broadcast scene in React. Render it in the browser and in OBS from the same code.

```tsx
import { Show, Scene, Layer, Color, Image, Browser } from "@strangecyan/vignette";

export default (
  <Show id="weekly" canvas={{ width: 1920, height: 1080 }}>
    <Scene id="main">
      <Layer style={{ position: "absolute", width: "100%", height: "100%" }}>
        <Color color="#0b0f1a" />
      </Layer>
      <Layer style={{ flexDirection: "row", gap: 24, padding: 48 }}>
        <Image src="logo.png" />
        <Browser url="https://example.com/ticker" />
      </Layer>
    </Scene>
  </Show>
);
```

```sh
npx vignette dev show.tsx                        # preview at http://localhost:4173
npx vignette obs http://localhost:4173/stream    # same show, in OBS
```

## How it works

```
React ──▶ composer ──▶ stream ──▶ browser (React or DOM)
                              └──▶ OBS
```

- You write a **show** in React. Layout is Yoga flexbox: `style` takes Yoga properties (`flex`,
  `flexDirection`, `gap`, `padding`, `position`, `width`, …) and nothing else. If you know React
  Native styles you know this.
- The **composer** runs React in Node, compiles every commit into an immutable **snapshot** of
  scenes, layers and sources, and publishes a **stream** of snapshots.
- A **target** turns snapshots into something visible: React or DOM elements in a browser, or
  managed scenes and inputs in OBS. Targets converge toward the latest snapshot and report their
  status; they never block the composer.

The composer never knows what targets exist. Targets never know what React is.

---

## 1. Project setup

```sh
pnpm add @strangecyan/vignette react react-dom @tanstack/react-query
pnpm add -D vite                  # for vignette dev, build and bundle
```

A host that only composes and drives OBS needs `@strangecyan/vignette` and `react` alone.
`react-dom` and `@tanstack/react-query` are for frames and browser clients; `vite` (for `dev`,
`build` and `bundle`) and `playwright` (for `preview`) are optional peers, loaded only by the
commands that use them.

One package, Node 22 or newer. Subpath exports keep each environment's code separate:

| Import                              | Contents                                                                                                        | Runs in                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `@strangecyan/vignette`             | show primitives, `compose`, `defineSource`, snapshot types, `createTarget`, `toSseEvent`, `fromSse`, `loadYoga` | Node, Bun, Deno, Workers, Electron |
| `@strangecyan/vignette/react`       | `Stream`, `Stage`, hooks, the built-in views (`ColorView`, …); needs `@tanstack/react-query`                    | browsers                           |
| `@strangecyan/vignette/dom`         | `domTarget` for pages without React, the built-in plugins (`colorDom`, …)                                       | browsers                           |
| `@strangecyan/vignette/obs`         | `obsTarget`, the built-in plugins (`colorObs`, …)                                                               | Node, Bun, Electron main           |
| `@strangecyan/vignette/obs/testing` | `FakeObs` and `ManualClock`, for testing OBS plugins and hosts                                                  | Node                               |
| `@strangecyan/vignette/frame`       | `frame`, for shows to import                                                                                    | Node and browsers                  |
| `@strangecyan/vignette/frame/mount` | `mountFrames`, the frame page's entry; `bundle` imports it                                                      | browsers                           |
| `@strangecyan/vignette/bundle`      | `bundle()`: frames page, frame bundle, hashed assets; `scanAssets`                                              | Node                               |
| `@strangecyan/vignette/vite`        | Vite plugin, for frontends that already use Vite                                                                | Node                               |

A minimal project:

```
my-show/
  show.tsx              # default export: the <Show>
  scoreboard.frame.tsx  # optional frames
  assets/               # files referenced by <Image src> and <Video src>
  package.json
```

No config file is needed for `vignette dev` and `vignette build`. One copy of React must be shared
between the show and `@strangecyan/vignette`; most bundlers do this by default, and
`dedupe: ["react"]` fixes the ones that do not.

---

## 2. Making a show

A show is a React component tree that renders to scenes, layers and sources instead of DOM.

### Scenes and layers

A show has one or more scenes. A scene is a flex container of layers. A layer either places one
source or groups other layers for layout.

```tsx
<Show id="weekly" canvas={{ width: 1920, height: 1080 }}>
  <Scene id="intro">
    <Layer style={{ flex: 1 }}>
      <Video src="intro.mp4" loop />
    </Layer>
  </Scene>

  <Scene id="main">
    <Layer style={{ flexDirection: "row", gap: 24, padding: 48 }}>
      <Layer style={{ flex: 2 }}>
        <Browser url="https://example.com/game" />
      </Layer>
      <Layer style={{ flex: 1, flexDirection: "column", gap: 24 }}>
        <Layer style={{ height: 400 }}>
          <Browser url="https://example.com/chat" />
        </Layer>
        <Layer style={{ flex: 1 }} fit="contain">
          <Image src="sponsor.png" />
        </Layer>
      </Layer>
    </Layer>
  </Scene>
</Show>
```

Only layers that contain a source become objects in the target. Layers with children are virtual
flex boxes and cost nothing.

Layer props: `style`, `fit` (`cover` | `contain` | `stretch`), `align`, `crop`, `opacity`,
`rotation`, `visible`, `id`.

### Sources

| Component | Renders as                      | Notes                                                             |
| --------- | ------------------------------- | ----------------------------------------------------------------- |
| `Color`   | solid fill                      | `color="#rrggbb"` or `#rrggbbaa`                                  |
| `Image`   | image asset                     | `src` is a file in your project                                   |
| `Video`   | media file                      | `src`, `loop`, `muted`, `restartOnShow`                           |
| `Browser` | web page                        | `url`, `viewport` (default: the layer size), `shutdownWhenHidden` |
| `Frame`   | a React DOM component as a page | see Frames below                                                  |
| `Text`    | styled text filling the layer   | `text`, `font` (a font file asset), `style`; see Text below       |

### Text

`<Text>` fills its layer's box, and `style` decides how the text sits in it. Its fields are named
after the CSS properties every target applies, because every target renders text as HTML: a `<div>`
in React and the DOM target, a local page in an OBS browser source. Layout sizes the box; it does
not measure the text, so give the layer the room the text needs.

```tsx
<Layer style={{ height: 200, padding: 40 }}>
  <Text
    text={"Up next\nThe weekly roundup"}
    font="fonts/Inter.woff2"
    style={{ fontSize: 64, textAlign: "center", textWrap: "balance", verticalAlign: "middle" }}
  />
</Layer>
```

`style` takes `fontFamily`, `fontSize` (default 48), `fontWeight`, `fontStyle`, `color` (default
white), `lineHeight`, `letterSpacing`, `textAlign`, `textWrap` (`wrap`, `nowrap`, `balance`,
`pretty`), `textTransform`, `textShadow`, `verticalAlign` (`top`, `middle`, `bottom`) and
`maxLines`. Line breaks in `text` are kept. `font` names a font file in your assets, downloaded and
verified like an image, so no target needs it installed; without it, `fontFamily` must name a font
the target has. In OBS a change is pushed into the open page rather than reloading it, so text can
change on air, or as its scene cuts in, without an empty frame.

A source placed inside a layer is owned by that layer. To use one source in several places, declare
it once at the show level with an `id` and place it with `<Use>`:

```tsx
<Show id="weekly" canvas={{ width: 1920, height: 1080 }}>
  <Browser id="chat" url="https://example.com/chat" />

  <Scene id="main">
    <Layer style={{ width: 480 }}>
      <Use source="chat" />
    </Layer>
  </Scene>
  <Scene id="brb">
    <Layer style={{ flex: 1 }}>
      <Use source="chat" />
    </Layer>
  </Scene>
</Show>
```

A shared source is one live instance. Its page stays loaded, its video keeps playing, and its
connection stays up across scene switches, in the browser and in OBS alike.

The built-ins are not special. Each is a `defineSource` plus a plugin per target, shipped in the
same package and registered by default. Section 7 shows how to add your own or replace these.

### Identity: what survives a re-render

Every re-render produces a new snapshot. A target compares it with the one it has and decides, for
each layer and source, whether this is _the same thing changed_ or _an old thing gone and a new
thing arrived_. That decision is made by ID, never by React keys or by comparing props.

| Same ID, props changed            | Different ID                                     |
| --------------------------------- | ------------------------------------------------ |
| Browser page keeps running        | Page reloads; scripts restart, state is lost     |
| Video keeps its playback position | Video restarts from the beginning                |
| Live stream stays connected       | Reconnects; black frame while it buffers         |
| OBS updates the item's transform  | OBS removes and recreates the scene item         |
| Filters an operator added persist | Filters are gone, because the input was replaced |

**By default you don't write IDs.** A layer's ID is derived from its path in the tree, and an inline
source takes its layer's ID. This is stable as long as the tree keeps its shape: toggling `visible`,
changing `style` or swapping a URL all keep identity. Reordering siblings does not: a derived ID is
the layer's position among its siblings, so reordered layers need explicit IDs.

**Write an explicit `id` when the tree changes shape around a layer you care about:**

- **Lists.** Items inserted, removed or reordered shift every later sibling's path. Give each a
  stable `id`, the way you would give a `key`.

  ```tsx
  {
    guests.map((guest) => (
      <Layer id={`guest-${guest.id}`} style={{ flex: 1 }}>
        <Browser url={guest.cameraUrl} />
      </Layer>
    ));
  }
  ```

- **Conditional siblings.** `{showTicker && <Layer>…}` before a layer changes that layer's path.
  Give the layer after it an `id`, or put the conditional one last.

- **Restructuring layout.** Moving a camera from a side column into a full-bleed layer changes its
  parent and so its derived ID. An explicit `id` tells the target it is the same camera and should
  animate the transform rather than reload the page.

Cross-scene sharing is a _source_ concern: an OBS scene item belongs to one scene, so a layer never
moves between scenes. What survives a switch is the shared source, as shown above.

IDs are scoped: layer IDs are unique within their scene, source IDs within the show. In OBS a scene
is named `vignette/<show>/<scene>` and a source's input `vignette/<show>/<source>`; a layer is its
source's input placed in its scene, so an operator can tell which React element owns what. OBS
scenes and inputs share one name space, so a scene and a source cannot share an ID, and one shared
source can be placed only once per scene (`DUPLICATE_PLACEMENT`).

### Assets

`src` paths are relative to the show file. The snapshot refers to an asset by **name and content
hash**, never by URL. Targets download each asset once per hash. Where assets are served is a
hosting decision (sections 3 and 4); the show does not change.

### State

A show is ordinary React. Hooks, context, timers, fetches and external stores all work. Every commit
becomes a new snapshot and every target converges to it.

```tsx
import { useEffect, useState } from "react";
import { Scoreboard } from "./scoreboard.frame.js";

export default function Esports() {
  const [score, setScore] = useState({ home: 0, away: 0 });

  useEffect(() => {
    const poll = setInterval(async () => {
      const response = await fetch("https://api.example.com/match/current");
      setScore(await response.json());
    }, 5_000);
    return () => clearInterval(poll);
  }, []);

  return (
    <Show id="esports" canvas={{ width: 1920, height: 1080 }}>
      <Scene id="main">
        <Layer style={{ flex: 1 }}>
          <Browser url="https://example.com/game" />
        </Layer>
        <Layer style={{ position: "absolute", top: 48, right: 48, width: 400, height: 120 }}>
          <Frame of={Scoreboard} params={score} />
        </Layer>
      </Scene>
    </Show>
  );
}
```

The show runs on the server. It can hold secrets, talk to databases and subscribe to anything; the
browser and OBS only ever see the compiled result. All hooks work, including `useEffect`, because
the composer is a full React renderer in the way React Native is. There is simply no DOM, so no
`window` or `document`.

### Switching scenes

The active scene is state like anything else:

```tsx
<Show id="weekly" canvas={canvas} activeScene={live ? "main" : "brb"}>
```

A browser target shows the active scene; the OBS target sets the program scene. Omit `activeScene`
to let the operator switch in OBS without the show fighting back.

### Frames

A frame is a React DOM component that becomes a web page, placed as a source. Frames run in the
page, so they can animate and hold their own state.

```tsx
// scoreboard.frame.tsx
import { z } from "zod";
import { frame } from "@strangecyan/vignette/frame";

export const Scoreboard = frame({
  name: "Scoreboard",
  params: z.object({ home: z.number(), away: z.number() }),
  view: ({ home, away }) => (
    <div className="scoreboard">
      {home} – {away}
    </div>
  ),
});
```

```tsx
<Frame of={Scoreboard} params={{ home: 2, away: 1 }} />
```

`name` identifies the frame in snapshots and in the frame page, and is unique within a project.
Params are validated against the schema in the show and again in the page. The snapshot carries
`{ frame: "Scoreboard", params }`, not a URL.

**How a frame gets data, and the one rule about it.** The show's stream is the only channel. Every
target, OBS and browser alike, shows a frame as the static frame page in an iframe. That page
follows the same stream, finds its source by ID, and re-renders when params change, so updating
params never reloads the page. The page learns the stream's URL from its own query string, which the
target fills in from the stream's setup message. Anything a frame needs from the server goes through
the show as params; anything else it fetches itself, as any web page would. There is no separate
frame data channel, store or endpoint.

A consequence worth stating: **clients know nothing about shows, scenes or frames.** A preview page
needs source plugins for the kinds the show uses and nothing else. The frame page is the only place
frame components are bundled, and it is built once by `bundle`.

### Best practice

- **Keep scenes flat and layers few.** Every layer with a source is an OBS scene item. Use nested
  layers for layout freely; they are free.
- **Prefer shared sources for anything stateful** that appears in more than one scene: cameras,
  chat, live streams. Inline sources are for things that belong to one place.
- **Add `id` to lists and anything you'll restructure live.** Everything else can stay derived.
- **Put logic in the show, not in frames.** The show has the data and runs once; a frame runs in
  every target that shows it. Frames are for motion and presentation.
- **Treat `activeScene` as a choice.** Drive it from the show for automated running orders; leave it
  out when an operator is at the OBS desk.

---

## 3. Running in development

```sh
npx vignette dev show.tsx           # composer + browser preview at :4173, stream at /stream
npx vignette dev show.tsx --obs     # also drive the local OBS at ws://127.0.0.1:4455
```

`dev` composes the show, serves the preview, the stream, the frame page and the assets on one
origin, and publishes all their locations in the stream so targets need no configuration. Edits
hot-reload the composer and targets converge without reconnecting. An edit that changes the show's
`id` or `canvas` starts a new composer instead, and connected targets reconnect to its new setup.
With `--obs`, add `--source <pkg>/obs` to load an OBS plugin for a custom source kind. The browser
preview has the built-in views only, so a custom kind shows there as an empty box.

```sh
npx vignette preview http://localhost:4173/stream --scene main --out main.png
```

`preview` renders one scene of a running stream to a PNG, for checks and docs, with Playwright's
Chromium (`pnpm add -D playwright`). Like every client it knows nothing about the show: frames
render as iframes to the frame page the stream names, and custom kinds render empty.

---

## 4. Hosting in production

### With the CLI

```sh
npx vignette build show.tsx         # dist/: server.js, show.js and public/
node dist/server.js                 # serves the preview at /, /stream, and public/ at /vignette/
```

`dist/show.js` is the show compiled for Node; `dist/public/` is what `bundle` writes plus the
preview page. Keep `dist` inside the project: both scripts import `@strangecyan/vignette` and React
from its `node_modules`. `PORT` and `HOST` choose where it listens, and `PUBLIC_ORIGIN` is the
address the stream publishes, which must be set when OBS reaches the server through a proxy or
another name.

Then on the machine with OBS:

```sh
npx vignette obs https://show.example.com/stream
```

### In your own server, step by step

The CLI is a thin wrapper. Everything is a function, nothing opens a port, and no part of the
library knows what HTTP is. Embedding in an existing Node process is five steps. The first two are
build steps you run once per deploy; the rest is code in your server.

**Step 1. Compile the show for Node.** `show.tsx` is ordinary TSX with no DOM. Compile it like the
rest of your server code (`tsc` with `"jsx": "react-jsx"`), or run it with `tsx`. Nothing from
Vignette is involved.

**Step 2. Bundle the browser-side pieces.** Frames are React DOM components, so they must be
compiled with React DOM into something a browser can load. Assets need hashing. One command does
both, independent of how you host:

```sh
npx vignette bundle show.tsx --out public/vignette
```

It compiles every `*.frame.tsx` (or `.jsx`) under the show's directory, hashes the files in the
`assets/` directory next to the show, and writes:

```
public/vignette/
  frames.html        # the page OBS opens; static, the same for every deployment
  frames.js          # every frame, React DOM and the mount code, one file
  assets/            # the files referenced by <Image src> and <Video src>
  assets.json        # the manifest: names and content hashes, for compose()
```

Serve that directory statically from anywhere: your server, a CDN, an S3 bucket. Nothing in it knows
where it will be hosted or where the stream is. `bundle` compiles frames with Vite, so it needs
`vite` installed. The same thing is available as a function for build scripts,
`bundle(showPath, { out })` from `@strangecyan/vignette/bundle`. If your frontend already uses Vite,
`vignette({ show })` from `@strangecyan/vignette/vite` composes the show inside `vite dev` and
serves its stream, frame page and assets there; production builds still run `bundle`.

**Step 3. Run the composer** in your process and tell it where things will be served: step 2's
output, and the stream itself.

```ts
import { compose } from "@strangecyan/vignette";
import manifest from "./public/vignette/assets.json" with { type: "json" };
import show from "./show.js";

const composer = compose(show, {
  assets: manifest,
  serve: {
    stream: "https://show.example.com/show/stream",
    assets: "https://show.example.com/vignette/assets/",
    frames: "https://show.example.com/vignette/frames.html",
  },
});
await composer.ready();
```

| Option     | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assets`   | the manifest from `bundle`, or `scanAssets(dir)` from `@strangecyan/vignette/bundle` at startup if you skipped bundling assets. Required if any source names an asset; a name missing from it is a compile diagnostic. Targets download every entry, so a non-empty manifest also requires `serve.assets`                                                                                                                                                            |
| `serve`    | absolute URLs where the stream, assets and `frames.html` are served. Published in the stream's setup message so targets need no local configuration. `stream` and `frames` are required if the show uses a `Frame`, `assets` if any source names an asset (an `Image` or `Video` `src`, a `Text` `font`) or `assets` lists any entry, since targets download every entry; a missing one is a compile diagnostic. An empty or absent manifest needs no `serve.assets` |
| `layout`   | a layout engine from `loadYoga(wasm)`, for hosts that cannot compile wasm at runtime (see below)                                                                                                                                                                                                                                                                                                                                                                     |
| `revision` | the revision of the first commit, and so of the first snapshot; later commits count up from it. Default 1. A host that composes anew for each change passes one past the last revision it published, so targets see revisions move forward                                                                                                                                                                                                                           |
| `onError`  | render and compile errors; also available as `status`                                                                                                                                                                                                                                                                                                                                                                                                                |

| Member                  | Purpose                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stream(signal?)`       | async iterable of stream messages; replays setup and the latest update. Setup is published a single time, before the first update and after the show has rendered, because its ID and canvas come from the show; it never changes after. A show's `id` and `canvas` are fixed for the composer's life: a render that changes either fails with `SHOW_IDENTITY_CHANGED` and the last snapshot stays live |
| `snapshot`              | latest compiled snapshot                                                                                                                                                                                                                                                                                                                                                                                |
| `ready()`               | resolves after the first successful compile                                                                                                                                                                                                                                                                                                                                                             |
| `settled()`             | flushes pending React work, resolves with the latest snapshot                                                                                                                                                                                                                                                                                                                                           |
| `once()`                | render, settle, dispose, return the snapshot; rejects if the show does not compile, e.g. an `Image` without `assets`                                                                                                                                                                                                                                                                                    |
| `bootstrap()`           | settle and return `[setup, update]`, exactly what `stream()` replays to a new subscriber; does not dispose                                                                                                                                                                                                                                                                                              |
| `emit(event)`           | publish a one-shot event                                                                                                                                                                                                                                                                                                                                                                                |
| `status`, `subscribe()` | compile phase and diagnostics as an external store                                                                                                                                                                                                                                                                                                                                                      |
| `dispose()`             |                                                                                                                                                                                                                                                                                                                                                                                                         |

**Hosting without a long-lived composer.** A host that cannot keep a composer in memory, such as a
Cloudflare Durable Object with hibernating WebSockets, keeps the show's state in storage and
composes the show anew from it on each change. Setup is fixed for the life of a show, so the host
saves it once; each change sends only the new update:

```ts
const composer = compose(show(state), { revision: saved.revision + 1, assets, serve, layout });
const [setup, update] = await composer.bootstrap();
composer.dispose();
// Save { setup, update, revision: update.snapshot.revision }; send update to open sockets.
// A new connection gets the saved setup, then the saved update.
```

**Step 4. Put the stream on a wire.** `composer.stream()` yields plain objects. `toSseEvent` and
`fromSse` are helpers for the common case, not requirements. `fromSse(url, { onConnection })`
reconnects with capped backoff and reports each `connecting`, `open`, `retry-wait` and `closed`.
Each frame page asks for its one source with `?source=`; pass `streamOptions(request.url)` as the
second argument and it gets only that source, only when it changes. A host that ignores the query
still works; every page just receives the whole snapshot every revision.

```ts
for await (const m of composer.stream(signal)) await sse.writeSSE(toSseEvent(m)); // SSE
for await (const m of composer.stream(signal)) socket.send(encodeStreamMessage(m)); // WebSocket
for await (const m of composer.stream(signal)) port.postMessage(m); // IPC, queue, file
obs.follow(composer.stream()); // same process
```

Frame pages, `<Stream url>`, `vignette obs` and `vignette preview` connect to a URL, and pick the
transport by its scheme: SSE for `http(s):`, WebSocket for `ws(s):` (`fromWebSocket`, one JSON
message per WebSocket message, reconnecting like `fromSse`). So `serve.stream` decides how frame
pages connect: publish `wss://show.example.com/stream` and every frame page uses WebSocket, with
`?source=<id>` on the URL as before. For any other scheme, write a `StreamTransport`,
`{ protocols: ["nats:"], connect(url, { signal, onConnection }) }`, and compile it into the frame
page with `vignette bundle show.tsx --out public/vignette --transport ./nats-transport.ts` (or
`bundle(show, { out, transports })`). Its module exports the transport, or an array of them.
`connect` must reconnect by itself and start every connection with setup and the latest update;
`reconnecting(url, open, options)` gives you the loop with backoff and `onConnection`, so a
transport only implements one connection. React clients pass the same objects as
`<Stream url transports={[nats]}>`.

**Step 5. Serve the bundle directory** at the URLs you stated in step 3. That's it. Every target
reads all three locations from the stream and opens
`frames.html?frame=Scoreboard&source=<id>&stream=<serve.stream>`; the page connects to that stream,
finds its source, and renders. The static files never learn where they live.

What the library needs from the host: `@strangecyan/vignette` needs ES2023, `react` and WebAssembly.
Yoga ships embedded and is compiled when the composer first lays out; a host that cannot compile
wasm at runtime, such as Cloudflare Workers, passes a precompiled module:
`import wasm from "@strangecyan/vignette/yoga.wasm"` and
`compose(show, { layout: await loadYoga(wasm) })`. `@strangecyan/vignette/obs` needs WebSocket,
`fetch` and a writable directory. No package reads `process.env`, touches the file system
unprompted, or opens a socket you did not ask for.

### Complete example: Express

```json
// package.json
{
  "scripts": {
    "build": "tsc && vignette bundle src/show.tsx --out public/vignette",
    "start": "node dist/server.js"
  }
}
```

```ts
// src/server.ts
import express from "express";
import { compose, streamOptions, toSseEvent } from "@strangecyan/vignette";
import { obsTarget } from "@strangecyan/vignette/obs";
import manifest from "../public/vignette/assets.json" with { type: "json" };
import show from "./show.js";

const app = express();
const origin = process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:3000";
const composer = compose(show, {
  assets: manifest,
  serve: {
    stream: `${origin}/show/stream`,
    assets: `${origin}/vignette/assets/`,
    frames: `${origin}/vignette/frames.html`,
  },
});
await composer.ready();

app.get("/show/stream", (req, res) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const abort = new AbortController();
  req.on("close", () => abort.abort());
  (async () => {
    for await (const m of composer.stream(abort.signal, streamOptions(req.url))) {
      const { id, event, data } = toSseEvent(m);
      res.write(`id: ${id}\nevent: ${event}\ndata: ${data}\n\n`);
    }
  })();
});

app.use("/vignette", express.static("public/vignette")); // frames.html, frames.js, assets/

// optional: OBS in this same process, reading the composer directly
const obs = obsTarget({ url: process.env.OBS_URL, password: process.env.OBS_PASSWORD });
obs.follow(composer.stream());

app.listen(3000);
```

A browser preview is `<Stream url="/show/stream"><Stage scene="main" /></Stream>` in any React page
this app serves. A remote OBS machine runs `vignette obs http://host:3000/show/stream` and learns
asset and frame locations from the stream.

The same code moves to a Durable Object by swapping `express` for the fetch handler and serving
`public/vignette` from R2, and to Electron by dropping the HTTP parts and calling
`obs.follow(composer.stream())` from the main process.

## 5. Making your own client

### React

In a React app the browser target _is_ React. A snapshot becomes a tree of elements, a source kind
is a component, assets suspend while they load, and status is the same `TargetStatus` every target
reports.

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { Stage, Stream, useStreamStatus } from "@strangecyan/vignette/react";

function Preview() {
  return (
    <QueryClientProvider client={queryClient}>
      <Stream url="/stream">
        <Suspense fallback={<Spinner />}>
          <Stage scene="main" className="aspect-video" />
        </Suspense>
        <Status />
      </Stream>
    </QueryClientProvider>
  );
}

function Status() {
  const { phase, revision, connection, error } = useStreamStatus();
  return (
    <small>
      {connection?.phase} · {phase} · r{revision.settled} {error?.message}
    </small>
  );
}
```

- **`<Stream>`** owns one connection and provides the snapshot by context. `url` is the common case
  and reconnects with backoff; `source={asyncIterable}` takes any other wire, including
  `composer.stream()` in the same page.
- **Status is the target status.** `useStreamStatus()` is the `TargetStatus` every target reports
  (`phase`, `revision: { desired, settled }`, `sources`, `error`), plus `connection` for a `url`
  stream: `connecting`, `open`, `retry-wait` or `closed`, with the last error. Before the first
  setup `phase` reads `connecting`, or `disconnected` once the connection is `closed`.
- **Plugins.** `sources={[MoqView]}` adds plugins and `builtins={false}` drops the built-in ones.
  `checkPlugins={false}` renders a kind without a plugin as an empty box (its source shows `error`)
  instead of failing the revision; the preview pages use it. `sources`, `builtins` and
  `checkPlugins` are read when the stream connects; changing them later has no effect until `url` or
  `source` changes.
- **The client is show-agnostic.** It needs the source plugins for the kinds a show uses and nothing
  else: no show code, no scene list, no frame definitions. Frames render as iframes to the static
  frame page, exactly as in OBS.
- **`<Stage>`** renders one scene as positioned elements from the compiled Yoga frames. Omit `scene`
  to follow the show's `activeScene`. It is a plain component: style it, wrap it, render two of them
  side by side under one stream.
- **Assets suspend.** `useAsset(name)` throws its promise until the download completes. Downloads
  are TanStack queries keyed by content hash, deduped across stages and surviving remounts.
- **Hooks for custom rendering.** `useSnapshot()`, `useScene(id)`, `useAsset(name)`, `useCanvas()`,
  `useSetup()`, `useStreamStatus()`, `useStreamEvents(handler)`, `useFrameUrl(frame, sourceId)`.

Identity holds: elements are keyed by layer and source ID, and shared sources are rendered once and
kept mounted across scene switches, so a shared browser source keeps its page alive as it does in
OBS. A `<Stage>` that follows `activeScene` renders every scene and hides all but the active one, so
inline sources stay mounted across switches too; `<Stage scene="…">` renders just that scene. A
source placed in more than one scene is rendered once by `<Stream>` into its own element, which each
`<Stage>` moves into the box that shows it with `moveBefore` (falling back to `append`, which
reloads iframes outside Chromium) and back to a hidden host when no stage shows it.

### DOM, without React

`@strangecyan/vignette/dom` is a separate target for pages without React. It shares the source
definitions and nothing else.

```ts
import { domTarget, fromSse } from "@strangecyan/vignette/dom";

const stage = document.querySelector<HTMLElement>("#stage");
if (stage === null) throw new Error("#stage is missing");

const target = domTarget(stage, { scene: "main" }); // omit `scene` to follow `activeScene`
const stop = target.follow(fromSse("/stream"));
target.subscribe(() => console.log(target.status.phase));
```

### The target contract

Every target, built in or yours, has the same shape:

| Member                  | Purpose                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `follow(stream)`        | consume a stream until it ends; returns `stop`                                                                                                         |
| `apply(message)`        | apply one message by hand                                                                                                                              |
| `status`, `subscribe()` | phase, desired and settled revision, per-source state with why a source failed (`sourceErrors`), last error, and `connection` for targets that own one |
| `settled(revision?)`    | resolves when the target has converged                                                                                                                 |
| `dispose()`             |                                                                                                                                                        |

---

## 6. The OBS runtime

```ts
import { fromSse, obsTarget } from "@strangecyan/vignette/obs";

const obs = obsTarget({ url: "ws://127.0.0.1:4455", password });
obs.follow(fromSse("https://show.example.com/stream")); // reconnects with backoff
```

or, equivalently, `npx vignette obs https://show.example.com/stream`.

**What it does.** Connects over obs-websocket, reads the current state of the scenes and inputs it
manages, and converges them to each snapshot with a dependency-ordered plan: create inputs, create
scenes, place and transform items, remove what is gone. Retries with backoff on transient errors.
Sets the program scene when the snapshot has an `activeScene`.

**What it never does.** Touch anything outside `vignette/<show>/…`. Scenes, inputs and filters an
operator created are invisible to it. A stream for a different show ID than the one the target
already manages is refused before any call to OBS.

**The asset stage.** When the setup message arrives, the target fetches every asset not already in
its cache, verifies each hash, and only then applies updates. Updates that arrive early are queued,
so the first scene appears complete rather than popping in.

```
setup ──▶ fetch missing assets ──▶ verify ──▶ connect ──▶ apply updates
       phase: "downloading-assets"           "synchronising"     → "settled"
                                  connection: "connecting" → "open"
```

The cache is a directory keyed by hash, so OBS inputs get local file paths and a show that changes
one logo re-downloads one file. Entries no longer in the manifest are evicted on the next setup. The
files OBS loads (assets, and pages such as text sources write) live in `dir`, by default
`@strangecyan/vignette/obs` in the user's cache directory, and stay after the target stops: OBS
saves their paths in its scene collection and asks for any missing file when it starts.

**Locations come from the stream.** The host published `serve.stream`, `serve.assets` and
`serve.frames` when it composed; the target reads them from setup. Frame pages are opened at
`serve.frames?frame=…&source=…&stream=serve.stream`. The only local options are overrides for
networks where OBS reaches the host at a different address than the one published:

| Option         | From the stream                 | Local override                                                     |
| -------------- | ------------------------------- | ------------------------------------------------------------------ |
| `assets.fetch` | `serve.assets`                  | any function from name and hash to bytes                           |
| `dir`          |                                 | a directory; default `@strangecyan/vignette/obs` in the user cache |
| `frames`       | `serve.frames` + `serve.stream` | any function from frame name and source ID to a URL                |
| `sources`      |                                 | plugins for custom source kinds (section 7)                        |

The remaining options are `url` (default `ws://127.0.0.1:4455`), `password`, `builtins` (as in
section 7) and `retry` (reconnect backoff), plus `transport` and `clock` for tests, which
`@strangecyan/vignette/obs/testing` fills with `FakeObs` and `ManualClock`.

There is no convention tier: the target never guesses a path, and it does not matter whether the
stream came from a URL, a socket, or an in-process call.

**Status.** The OBS target reports the same `TargetStatus` as every target. `status.phase` runs
`downloading-assets` → `synchronising` → `settled`, or `error`; the asset stage comes first, and the
target connects when the first snapshot is ready to apply. `status.connection` is the websocket:
`connecting`, `open`, `retry-wait` while it backs off (with the error that dropped it), and `closed`
when OBS refuses the session for good (close code 4011), which also fails the revision in flight. So
"waiting for OBS" is `synchronising` with `connection.phase: "connecting"`, and "disconnected" is
`connection.phase: "retry-wait"`; both are observable states rather than exceptions. `status.assets`
reports `{ done, total, failed }` during the asset stage. A source whose plugin is still preparing
shows as such while the rest of the scene converges around it.

---

## 7. Making your own sources and plugins

Vignette has one extension seam per layer of the pipeline:

- The **composer** knows a source _kind_ and its _props_. That is all it needs to validate and lay
  out a show. It never knows how a kind is rendered.
- Each **target** owns a plugin interface for rendering kinds in its medium, with a lifetime matched
  to how that medium works. You hand plugins to the target when you create it.
- A **new target** defines its own plugin interface, or none at all.

### Defining a source kind

```ts
// moq/index.ts
import { defineSource } from "@strangecyan/vignette";
import { z } from "zod";

export const Moq = defineSource({
  kind: "moq",
  props: z.object({
    url: z.string().url(),
    broadcast: z.string().min(1),
    size: z.object({ width: z.number(), height: z.number() }),
    latencyMs: z.number().int().min(0).max(30_000).default(100),
  }),
  size: (props) => props.size,
});
```

`defineSource` returns a React component typed from `props`:

```tsx
<Layer style={{ flex: 1 }}>
  <Moq url="https://relay.example" broadcast="main" size={hd} />
</Layer>
```

The composer validates props with the schema, uses `size` for `fit`, and carries kind and props
through the snapshot. Nothing is registered with the composer; importing the component is enough.

### The plugin lifetime

Every target asks a plugin to **create** a handle when a source ID first appears in a snapshot,
**update** it when props change under the same ID, and **dispose** it when the ID is gone. Shared
sources live across scene switches; inline ones live as long as their layer. What a handle _is_
depends on the target.

### React plugin

A component. It receives the source and the compiled item and renders inside a positioned box the
stage provides. Hooks, `use()`, Suspense and effects all work.

```tsx
// moq/react.tsx
import { lazy, Suspense } from "react";
import type { ReactSourcePlugin } from "@strangecyan/vignette/react";
import type { Moq } from "./index.js";

const MoqWatch = lazy(() => import("./moq-watch-element.js"));

export const MoqView: ReactSourcePlugin<typeof Moq> = {
  kind: "moq",
  View: ({ source }) => (
    <Suspense fallback={null}>
      <MoqWatch
        url={source.props.url}
        name={source.props.broadcast}
        latency={source.props.latencyMs}
      />
    </Suspense>
  ),
};
```

### DOM plugin

An element with the create, update, dispose lifetime. Separate from the React plugin; shares only
the source definition.

```ts
// moq/dom.ts
import type { DomSourcePlugin } from "@strangecyan/vignette/dom";
import type { Moq } from "./index.js";

export const moqDom: DomSourcePlugin<typeof Moq> = {
  kind: "moq",
  async load() {
    await import("@moq/watch/element");
  },
  create(source, { document }) {
    const el = document.createElement("moq-watch");
    const apply = (props) => {
      el.setAttribute("url", props.url);
      el.setAttribute("name", props.broadcast);
      el.setAttribute("latency", String(props.latencyMs));
    };
    apply(source.props);
    return { element: el, update: (next) => apply(next.props), dispose: () => el.remove() };
  },
};
```

A handle may also implement `activate()`, called when its element enters the shown scene; the
built-in video uses it for `restartOnShow`.

### OBS plugin

An input kind plus settings. `create` may be asynchronous and own whatever it takes to produce them.
A plugin that needs an external process starts it in `create` and stops it in `dispose`:

```ts
// moq/obs.ts
import type { ObsSourcePlugin } from "@strangecyan/vignette/obs";
import type { Moq } from "./index.js";

/** Relay the MoQ broadcast through the `moq` CLI as RTMP, which a stock media source plays. */
export const moqObs: ObsSourcePlugin<typeof Moq> = {
  kind: "moq",
  async create(source, { port }) {
    const address = `127.0.0.1:${await port()}`;
    let relay = await startRelay(source.props, address); // `moq … export rtmp --listen <address>`
    return {
      input: {
        kind: "ffmpeg_source",
        settings: { input: `rtmp://${address}/live/moq`, is_local_file: false },
      },
      async update(next) {
        await relay.stop();
        relay = await startRelay(next.props, address); // same port: the input does not change
      },
      dispose: () => relay.stop(),
    };
  },
};
```

For an OBS with the native `moq_source` input, the plugin is three lines.
`@strangecyan/vignette-moq/obs` chooses between the two by `inputKinds`:

```ts
export const moqObsNative: ObsSourcePlugin<typeof Moq> = {
  kind: "moq",
  create: (source) => ({
    input: {
      kind: "moq_source",
      settings: { url: source.props.url, broadcast: source.props.broadcast },
    },
  }),
};
```

A handle without `update` is re-created when its props change: `create` runs again and the old
handle is disposed, which is what makes the three-line form correct. `input` may also carry `muted`
for inputs with audio.

While `create` is pending the target reports the source as `preparing` and the rest of the scene
converges around it. A rejected `create` is a source-level error in status, not a crash.

### The plugin context

| Member           | React           | DOM | OBS | Purpose                                                 |
| ---------------- | --------------- | --- | --- | ------------------------------------------------------- |
| `assets.resolve` | `useAsset()`    | ✓   | ✓   | downloaded asset by name, as object URL or file path    |
| `frames`         | `useFrameUrl()` | ✓   | ✓   | page URL for a frame name and source ID                 |
| `canvas`         | `useCanvas()`   | ✓   | ✓   | show canvas size                                        |
| `document`       | implicit        | ✓   |     | the stage's owner document                              |
| `inputKinds`     |                 |     | ✓   | input kinds this OBS advertises, so a plugin can choose |
| `port()`         |                 |     | ✓   | a free local port for plugins that spawn processes      |
| `request()`      |                 |     | ✓   | one obs-websocket request about the source's own input  |
| `sourceFile()`   |                 |     | ✓   | a lasting file path for the source, same on every run   |
| `signal`         | unmount         | ✓   | ✓   | aborts when the target is disposed                      |

### The built-ins are plugins too

Nothing in the composer or the targets knows about images, videos, browsers or colors. Each built-in
is a `defineSource` in `@strangecyan/vignette` and one plugin per target, written against the same
public interfaces as above. This is the whole of `Color`:

```tsx
// vignette
export const Color = defineSource({
  kind: "color",
  props: z.object({
    color: z.string().regex(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i),
    size: ContentSizeSchema.optional(),
  }),
  size: (props, { canvas }) => props.size ?? canvas,
});

// vignette/react
export const ColorView: ReactSourcePlugin<typeof Color> = {
  kind: "color",
  View: ({ source }) => (
    <div style={{ width: "100%", height: "100%", background: source.props.color }} />
  ),
};

// vignette/dom
export const colorDom: DomSourcePlugin<typeof Color> = {
  kind: "color",
  create(source, { document }) {
    const el = document.createElement("div");
    const apply = (props) => {
      el.style.background = props.color;
    };
    apply(source.props);
    return { element: el, update: (next) => apply(next.props), dispose: () => el.remove() };
  },
};

// vignette/obs
export const colorObs: ObsSourcePlugin<typeof Color> = {
  kind: "color",
  create: (source) => ({
    input: {
      kind: "color_source_v3",
      settings: {
        color: abgr(source.props.color),
        width: source.size.width,
        height: source.size.height,
      },
    },
  }),
};
```

`Image` and `Video` use `assets.resolve`. `Browser` uses the laid-out size for its default viewport.
`Frame` uses `frames` in every target to build the frame page URL. If a built-in needed something
the context did not provide, that would be a gap in the plugin model, not a reason for a private
back door.

### Registering plugins

Plugins go to the target that runs them. Built-ins are present unless you say otherwise.

```ts
<Stream url="/stream" sources={[MoqView]} />                          // React
domTarget(el, { sources: [moqDom] });                                 // DOM
obsTarget({ url, password, sources: [moqObs, myBrowserObs] });       // later entries win per kind
obsTarget({ url, password, sources: [colorObs], builtins: false });  // only what you list
```

```sh
npx vignette obs https://show.example.com/stream --source @strangecyan/vignette-moq/obs
```

A target checks each revision's source kinds against its plugins as it arrives. A revision using a
kind it has no plugin for fails with `missing source plugin for kind "moq"` in its status before any
of its sources is created or rendered, so a misconfigured OBS machine fails loudly and leaves OBS as
it was; a later revision without that kind applies as usual. A client that should render what it can
instead (`<Stream checkPlugins={false}>`, `createTarget({ checkPlugins: false })`) marks only the
sources of that kind `error`.

Published source packages ship the definition and one entry per target, for example
`@strangecyan/vignette-moq`, `@strangecyan/vignette-moq/react`, `@strangecyan/vignette-moq/dom`,
`@strangecyan/vignette-moq/obs`, so a show never bundles browser or Node code it does not run.

### A new target

A target consumes a stream and produces side effects. `createTarget` provides plugin checks, the
asset stage, status, settlement and the plugin lifetime; you supply the medium.

```ts
import { createTarget } from "@strangecyan/vignette";

export function canvasTarget(canvas: HTMLCanvasElement, plugins: CanvasSourcePlugin[]) {
  return createTarget<CanvasHandle>({
    kind: "canvas",
    sources: plugins, // your own plugin interface
    update(snapshot, handles) {
      // handles: Map<sourceId, CanvasHandle>
      draw(
        canvas,
        snapshot.scenes.find((scene) => scene.id === snapshot.activeScene),
        handles,
      );
    },
  });
}
```

Your plugin interface is whatever `CanvasHandle` needs to be. A target with no notion of sources,
like one that logs revisions, omits `sources`.

The promise `update` returns is the only settlement signal: the revision counts as settled when it
resolves, and a rejection is that revision's `error`. A medium with a connection of its own reports
it through `connection(report)`, which the kernel starts once and stops on dispose; each report
becomes `status.connection`. `checkPlugins: false` turns a kind without a plugin from a failed
revision into an `error` on each source of that kind, for clients that render what they can.

### Events

Events are one-shot commands that are not part of desired state, such as restarting a video.

```ts
composer.emit({ kind: "media:restart", sourceId: "intro" });
```

Targets handle the events they know and ignore the rest. A plugin's handle opts in with an
`event(event)` member; an event with a `sourceId` reaches only that source's handle.

---

## Guarantees

- Snapshots are plain immutable data. Anything that can read JSON can be a target.
- Snapshots name resources; they never contain a location. Hosts state locations once.
- Explicit IDs, never React keys, identify remote resources.
- The OBS target touches only resources in its show's namespace.
- Target failures are status, never exceptions in your show's React tree. (In a `<Stream>` page, an
  asset that fails to download reaches the nearest error boundary, like any Suspense resource.)
- Desired state (snapshots) and one-shot commands (events) never mix.
- The show's stream is the only channel from composer to anything.
