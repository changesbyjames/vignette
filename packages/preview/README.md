# @strangecyan/vignette-preview

Creates an exact-canvas PNG from a compiled Vignette snapshot. Images, colors, and browser sources
render normally. Media files, MoQ streams, and extension sources render as labeled placeholders so a
preview does not need live media infrastructure.

Install the npm CLI package in a Vignette project:

```sh
pnpm add -D @strangecyan/vignette-preview
pnpm exec playwright install chromium
```

```sh
pnpm exec vignette preview \
  --snapshot http://localhost:4173/runtime \
  --scene programme \
  --name "test 01"
```

`--snapshot` accepts a JSON file, a JSON URL, or a Vignette runtime SSE URL. JSON may contain the
snapshot directly or an object with `{ "snapshot": ..., "manifest": ... }`. The first scene is used
unless `--scene <id|label>` or `--all-scenes` is supplied.

By default PNGs are written under `vignette-preview/`. Use `--out <file>` for one scene or
`--out <directory> --all-scenes` for multiple scenes. `--json` prints result metadata for agents and
scripts.
