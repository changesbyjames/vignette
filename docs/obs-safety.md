# OBS safety model

The OBS target owns exactly one namespace per show and nothing else. The behaviour is specified in
[README §6](../README.md#6-the-obs-runtime); this page is the operator's summary.

- **Names.** The registry scene is `vignette/<show>`, scenes are `vignette/<show>/<scene>`, inputs
  are `vignette/<show>/<source>`. Scene items have no names; an item is its source's input placed in
  its scene. Anything else (other shows, operator scenes, inputs and filters) is invisible to the
  planner and never modified.
- **One show per target.** A target binds to the first show ID it sees; a snapshot for another show
  fails its apply before any request is sent.
- **Convergence.** The target observes OBS, plans the difference, executes it in dependency order
  and observes again until nothing is left to do. Manual edits to managed transforms are drift and
  are overwritten. Inputs whose kind changed underneath it are reported, not replaced, so operator
  filters are never lost silently.
- **Program scene.** Set only when the snapshot's `activeScene` changes. Omit `activeScene` and the
  operator switches scenes freely.
- **Failures are status.** Disconnects, retries, missing plugins and failed plugin `create`s show in
  `status`; they never throw into the composer.
- **Secrets.** Pass the password as an option. No package reads environment variables or logs
  credentials; do not ship obs-websocket passwords to browsers.

## Integration tests

`examples/kitchen-sink/tests/obs-integration.spec.ts` drives a real OBS. It runs only with
`VIGNETTE_ALLOW_INTEGRATION=1` and refuses to start unless OBS's current scene collection is the one
named by `VIGNETTE_OBS_TEST_COLLECTION`. Cleanup removes only scenes under the show's managed
prefix; never point it at a collection you care about.
