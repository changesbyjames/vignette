# Spike: remote assets

Status: exploration, nothing built. Question: how could a show use fonts, images or video that do
not live in the project's `assets/` folder?

## How assets work today

- An asset is a file under the show's `assets/` folder. `bundle` (or `vignette dev`) scans it into
  a manifest of `{ name, hash }` entries; the manifest never contains a location.
- The setup message carries the manifest and `serve.assets`, the one URL every asset is fetched
  from (`serve.assets + name`).
- Every target runs an asset stage after setup: download each entry, verify its sha256, keep it in
  a store keyed by hash (object URLs in browsers, files for OBS). Plugins then `resolve(name)`.
- What that buys: assets are ready before the first render, corrupt or changed bytes fail loudly,
  targets need no access beyond the show's own server, and browser targets never hit CORS.

Remote assets come in two kinds, and they want different answers:

| Kind                | Example                                  | Known when                | Bytes change? |
| ------------------- | ---------------------------------------- | ------------------------- | ------------- |
| **Pinned remote**   | a CDN font, a package font, a stock clip | at build time             | no            |
| **Live remote**     | sponsor logos from a CMS, guest avatars  | at run time, from props   | yes           |

## Option A: mirror pinned remotes at build time (recommended first)

Declare where an asset comes from; `bundle` and `vignette dev` fetch it into the manifest like any
local file. Nothing downstream changes: the stream, kernel, targets and plugins see an ordinary
asset.

```ts
// vignette.assets.ts, next to the show (or an option of bundle())
import { remote, pkg } from "vignette/bundle";

export default {
  "fonts/nunito-700.woff2": pkg("@fontsource/nunito/files/nunito-latin-700-normal.woff2"),
  "fonts/inter.woff2": remote("https://cdn.jsdelivr.net/npm/@fontsource/inter@5.2.5/files/inter-latin-400-normal.woff2", {
    integrity: "sha256-…", // optional; fails the build when the bytes differ
  }),
};
```

```tsx
<Text text="Up next" font="fonts/nunito-700.woff2" />
```

- `pkg()` resolves from the show's `node_modules`, which retires the kitchen sink's copy script.
- `remote()` downloads once into a cache (`node_modules/.cache/vignette`), keyed by URL and
  `integrity`; without `integrity` the first download is pinned in a lockfile (`assets.lock`) so a
  CDN change is a visible diff, not a silent swap.
- Validation is unchanged: a name the show uses that is neither a file nor declared is still
  `MISSING_ASSET`.
- Cost: `bundle`, the dev composer and `scanAssets` merge declared entries with scanned files;
  roughly 150 lines plus tests. No protocol or target change.

Fit for: fonts, logos, intro videos, anything chosen when the show is written.

## Option B: targets fetch live remotes themselves (opt-in, unverified)

A source prop holds a URL instead of an asset name, and each target loads it directly, the way
`Browser` already does with `url`.

```tsx
<Image url={guest.avatarUrl} size={{ width: 400, height: 400 }} />
<Text text={guest.name} fontUrl="https://fonts.example.com/brand.woff2" />
```

| Target       | Image                                 | Video                         | Font                                     |
| ------------ | ------------------------------------- | ----------------------------- | ---------------------------------------- |
| React / DOM  | `<img src>`                           | `<video src>`                 | `@font-face` URL; **the host must send CORS headers** |
| OBS          | plugin downloads to a temp file first, since `image_source` reads files | `ffmpeg_source` plays the URL | plugin downloads and embeds as today |

- No pre-download stage: the first render may show nothing until the bytes arrive, and a slow or
  failing host shows as a `preparing` or `error` source, not a blank target.
- No hash: the target trusts the URL. Caching follows HTTP (`ETag`, `Cache-Control`); the OBS
  plugin re-downloads when the URL changes.
- Every target needs network access to the remote host, including the OBS machine.
- Cost: a `url` prop on `Image` and `Video` (mutually exclusive with `src`), a `fontUrl` on `Text`,
  and OBS download helpers; roughly 200 lines. No protocol change.

Fit for: CMS images and avatars where pre-verification is not worth a round trip through the
show's server.

## Option C: the composer mirrors live remotes at run time (the "correct" model, deferred)

The host gives the composer a fetcher; when a commit references a URL, the composer downloads it,
hashes it, writes it where `serve.assets` is served, and adds the entry to the manifest. Targets
keep their verified, pre-downloaded asset stage for everything.

It needs two things the design does not have:

1. **An incremental manifest.** Today a new manifest means a new setup, and a changed setup resets
   every target (handles disposed, assets evicted). The stream would need an `assets` message, or
   update snapshots carrying new entries, and the kernel an asset stage that adds entries without a
   reset.
2. **A host-side asset store.** The library deliberately does not serve HTTP. The host would pass
   `compose({ assets: { manifest, mirror: (url) => Promise<{ name, hash }> } })` and own the writing
   and serving.

Cost: a stream protocol change, a kernel change, and a new host contract; several hundred lines and
the riskiest part of the system. Worth it only if live remotes become central to shows and must
work through restrictive networks (OBS machines that can reach only the show's server).

## Recommendation

1. Build **A** now. It covers fonts and other pinned media, removes the copy-script boilerplate,
   and keeps every guarantee.
2. Build **B** when a show needs CMS-driven media, scoped to `Image`, `Video` and `Text`, and
   documented as unverified with CORS requirements for browser targets.
3. Keep **C** in reserve; revisit if B's network or verification gaps hurt in practice.

## Open questions

- Does `integrity` default to required for `remote()` (safer) or to lockfile pinning (friendlier)?
- Should `pkg()` and `remote()` live in a config file next to the show, or as `bundle()` and
  `vignette dev` options? A file is discoverable by both without new CLI flags.
- For B, should OBS cache downloads across sources by URL, or per source as plugins do now?
