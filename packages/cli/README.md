# @strangecyan/vignette-cli

Command-line helpers for running and inspecting Vignette projects.

Install the npm CLI package in a Vignette project:

```sh
pnpm add -D @strangecyan/vignette-cli
pnpm exec playwright install chromium
```

## Stream to OBS

Stream a composer stream (SSE) to OBS with the built-in source codecs:

```sh
pnpm exec vignette obs \
  --project demo \
  --obs-url ws://localhost:4455 \
  --password secret \
  --url https://localhost:5173/api/stream
```

`--project` is the safety boundary: the command only ever modifies OBS resources in that project's
managed namespace. It must equal the composition's `id`, which the stream's setup message carries;
on a mismatch the runtime refuses to manage OBS and reports "Stream is for project 'x' but this OBS
runtime manages project 'y'".

### Extensions

Extension source kinds need their OBS codec loaded with `--extension <module>` (repeatable):

```sh
pnpm exec vignette obs --project demo --obs-url ws://localhost:4455 \
  --url https://localhost:5173/api/stream \
  --extension @strangecyan/vignette-moq/obs
```

The module is imported once at startup. Relative paths and package specifiers resolve from the
current directory, so install the extension package alongside the CLI. Every export — named or
default — that is an `ObsSourceCodec` (an object with `kind`, `inputKinds`, and `compile`), or an
array of codecs, is registered; a module that exports none is an error. No extension is bundled.
When the stream advertises an extension kind without a loaded codec, the command reports the
entrypoint to load, e.g. "Stream requires source kind 'source:moq'; register
@strangecyan/vignette-moq/obs.", and leaves OBS untouched. The CLI never imports modules named by
the stream itself.

Root-relative asset and browser-source URLs in snapshots resolve against `--url`. Add
`--browser-source-base-url <url>` when OBS reaches the composer at a different address than this
command. `--password` is optional for OBS instances without WebSocket authentication. The command
runs until it receives `SIGINT` or `SIGTERM`. It intentionally provides only the standard happy-path
runtime: there is no health endpoint or readiness checking.

## Capture a PNG

```sh
pnpm exec vignette preview \
  --snapshot http://localhost:4173/stream \
  --scene programme \
  --name "test 01"
```

`--snapshot` accepts a JSON file, a JSON URL, or a Vignette composer stream (SSE) URL. JSON may
contain the snapshot directly or an object with `{ "snapshot": ..., "manifest": ... }`. The first
scene is used unless `--scene <id|label>` or `--all-scenes` is supplied. Root-relative URLs resolve
against the snapshot URL; a snapshot file that contains them requires `--base-url <url>`.

By default PNGs are written under `vignette-preview/`. Use `--out <file>` for one scene or
`--out <directory> --all-scenes` for multiple scenes. `--json` prints result metadata for agents and
scripts.
