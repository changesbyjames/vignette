# Soak example

A day-long longevity test: the kitchen sink's recipe pushed hard, run into a real OBS, streamed to
Twitch, and measured throughout. Built for a Windows machine with an isolated portable OBS (see
`C:\vignette-tools` below); the show and server run anywhere.

## What runs

```text
ffmpeg test pattern ─▶ moq server (×6) ─┐
cdn.moq.dev/demo ───────────────────────┼─▶ vignette server (compose + obsTarget + moq relays) ─▶ OBS
                                        │
OBS ─RTMP─▶ MediaMTX ─┬─▶ ffmpeg -c copy ─▶ Twitch
                      ├─▶ ffmpeg analyzer (freezedetect, blackdetect, decoded fps)
                      └─▶ recordings/ (fMP4, 10-minute segments)
```

- [`src/show.tsx`](src/show.tsx): seven MoQ feeds (six local test patterns, one public) in six
  scenes, switched every 20 s. Layouts, colours, text and frame params change every second; an
  eighth MoQ source (`guest`) exists for one minute in five, a ticker frame for one minute in two,
  and `cam-6`'s latency flips every ten minutes, which restarts its relay. Every create, update and
  dispose path in the OBS target runs thousands of times a day.
- [`src/server/entry.ts`](src/server/entry.ts): the kitchen sink's server without the preview app,
  driving OBS in-process. [`src/server/probe.ts`](src/server/probe.ts) reports to the harness over
  IPC: how long each revision takes to settle, revisions coalesced, status transitions, memory and
  event loop delay.
- [`src/harness/soak.ts`](src/harness/soak.ts): starts and supervises everything above (restarting
  anything that exits), owns the isolated OBS (killing it if it stops answering for 90 s), sets up
  its `vignette-soak` profile and collection (1080p60, AMD encoder, 6000 kbps, stream to MediaMTX,
  every outside audio input muted), and injects faults every 45 minutes from 30 minutes in: a
  publisher down for 20 s, or a MoQ relay killed (`--no-chaos` turns this off).

## What it measures

Each run gets a directory under `C:\vignette-soak-runs\<start time>\`:

| File            | Contents                                                                                                                                                                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `samples.jsonl` | OBS stats and stream status (5 s), server probe (5 s), per-process-group memory, handles, threads and CPU (30 s), MediaMTX bytes in and out (30 s), feed media states (30 s), feed freeze checks (60 s), scene switch times, the Twitch relay's and the analyzer's ffmpeg progress (5 s) |
| `events.jsonl`  | starts, exits and restarts, stream state, source errors, connection changes, feed freezes, program freezes and black frames, injected faults                                                                                                                                             |
| `report.html`   | rewritten every 15 minutes: memory growth per hour, dropped frame rates, restarts, freezes, a chart per measurement, and the events                                                                                                                                                      |
| `status.json`   | the latest headline numbers                                                                                                                                                                                                                                                              |
| `logs/`         | every process's output                                                                                                                                                                                                                                                                   |
| `recordings/`   | the program as MediaMTX received it                                                                                                                                                                                                                                                      |

The Twitch stream key is redacted from everything written.

## Running it on the Windows machine

Tools live in `C:\vignette-tools`: the portable OBS (`obs\`), `moq\`, `ffmpeg\`, `mediamtx\`, and
`iso-env.cmd`, which sets the isolated OBS's websocket URL and password.

```bat
cd C:\vignette && pnpm build && pnpm --filter @vignette/soak build
powershell -File C:\vignette-tools\soak-start.ps1 -arguments "--hours 24"
powershell -File C:\vignette-tools\peek.ps1        & rem status, notable events, latest samples
powershell -File C:\vignette-tools\soak-stop.ps1   & rem finish early: stop streaming, write the report
```

`soak-start.ps1` runs the harness as an interactive scheduled task, so OBS appears in the tray and
the run outlives the ssh session. The Twitch relay starts once `C:\vignette-tools\twitch-key.txt`
holds a stream key, so a run can start before the key is there. `--bandwidth-test` appends
`?bandwidthtest=true`, which Twitch ingests without going live.
`pnpm --filter @vignette/soak report <run directory>` regenerates a report.
