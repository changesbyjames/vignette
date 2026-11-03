/**
 * Turns a run directory's `samples.jsonl` and `events.jsonl` into `report.html`: headline numbers
 * (memory growth per hour, dropped frames, restarts, freezes), a chart per measurement, and the
 * events. The harness rewrites it every 15 minutes; run it by hand on any run:
 *
 * ```sh
 * node dist/harness/report.js C:\vignette-soak-runs\<run>
 * ```
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import type { EventLine, Probe, SampleData, SampleLine } from "./samples.js";

type Point = readonly [hours: number, value: number];
interface Series {
  readonly name: string;
  readonly points: readonly Point[];
}

/** One probe's samples, in order. */
interface Timed<P extends Probe> {
  readonly t: number;
  readonly data: SampleData[P];
}
type Buckets = { [P in Probe]: Timed<P>[] };

/** A run's lines, read back. */
interface RunData {
  readonly samples: Buckets;
  readonly events: readonly EventLine[];
  readonly start: number;
  readonly end: number;
}

/** The JSON lines of `path`, skipping a last line a crash cut short. */
async function readLines(path: string): Promise<string[]> {
  const text = await readFile(path, "utf8").catch(() => "");
  return text.split("\n").filter((line) => line.trim() !== "");
}

function parseSample(line: string): SampleLine | undefined {
  try {
    // SAFETY: the harness wrote every line from the typed `Run.sample`.
    return JSON.parse(line) as SampleLine;
  } catch {
    return undefined;
  }
}

function parseEvent(line: string): EventLine | undefined {
  try {
    // SAFETY: the harness wrote every line from the typed `Run.event`.
    return JSON.parse(line) as EventLine;
  } catch {
    return undefined;
  }
}

async function load(dir: string): Promise<RunData> {
  const samples: Buckets = {
    obs: [],
    server: [],
    system: [],
    mediamtx: [],
    "scene-switch": [],
    feeds: [],
    frozen: [],
    "twitch-relay": [],
    analyzer: [],
  };
  let last = 0;
  // Sorts each sample into its probe's bucket; the run spans the first event to the last line.
  for (const line of await readLines(join(dir, "samples.jsonl"))) {
    const sample = parseSample(line);
    if (sample === undefined) continue;
    // SAFETY: `sample.probe` names the bucket whose data type `sample.data` has.
    (samples[sample.probe] as Timed<Probe>[]).push(sample);
    last = sample.t;
  }
  const events = (await readLines(join(dir, "events.jsonl"))).flatMap(
    (line) => parseEvent(line) ?? [],
  );
  const start = events[0]?.t ?? Date.now();
  return { samples, events, start, end: Math.max(last, events.at(-1)?.t ?? start) };
}

export async function writeReport(dir: string): Promise<void> {
  const data = await load(dir);
  const hours = (t: number) => (t - data.start) / 3_600_000;
  const series = <P extends Probe>(
    probe: P,
    name: string,
    pick: (sample: SampleData[P]) => number | undefined,
  ): Series => ({
    name,
    points: data.samples[probe].flatMap((sample: Timed<P>) => {
      const value = pick(sample.data);
      return value === undefined || !Number.isFinite(value)
        ? []
        : [[hours(sample.t), value] as const];
    }),
  });
  const html = page(
    tiles(data, series),
    charts(series).map(([title, unit, list]) => chart(title, unit, list, hours(data.end))),
    eventCounts(data.events),
    notableEvents(data.events),
    new Date(data.start).toISOString(),
  );
  await writeFile(join(dir, "report.html"), html);
}

type SeriesOf = <P extends Probe>(
  probe: P,
  name: string,
  pick: (sample: SampleData[P]) => number | undefined,
) => Series;

const MB = (bytes: number | undefined) => (bytes === undefined ? undefined : bytes / 1e6);
const kbits = (rate: string | undefined) =>
  rate === undefined ? undefined : Number.parseFloat(rate);

/** A series of how much a counter grew per sample; a counter that went down was reset. */
function increase(series: Series): Series {
  return {
    name: series.name,
    points: series.points.slice(1).map(([h, value], index) => {
      const previous = series.points[index]?.[1] ?? value;
      return [h, Math.max(0, value - previous)] as const;
    }),
  };
}

function charts(series: SeriesOf): [string, string, Series[]][] {
  return [
    ["OBS memory", "MB", [series("system", "OBS", (d) => MB(d.groups.obs.private))]],
    [
      "OBS browser pages memory",
      "MB",
      [series("system", "Pages", (d) => MB(d.groups["obs-browser"].private))],
    ],
    [
      "OBS browser pages",
      "processes",
      [series("system", "Pages", (d) => d.groups["obs-browser"].count)],
    ],
    ["OBS handles", "handles", [series("system", "Handles", (d) => d.groups.obs.handles)]],
    [
      "Server memory",
      "MB",
      [
        series("server", "RSS", (d) => MB(d.memory.rss)),
        series("server", "Heap used", (d) => MB(d.memory.heapUsed)),
      ],
    ],
    [
      "MoQ relays memory",
      "MB",
      [series("system", "Relays", (d) => MB(d.groups["moq-relays"].private))],
    ],
    ["MoQ relays", "processes", [series("system", "Relays", (d) => d.groups["moq-relays"].count)]],
    ["MediaMTX memory", "MB", [series("system", "MediaMTX", (d) => MB(d.groups.mediamtx.private))]],
    ["OBS CPU", "%", [series("obs", "CPU", (d) => d.cpuUsage)]],
    ["Frame render time", "ms", [series("obs", "Render time", (d) => d.averageFrameRenderTime)]],
    ["OBS output frame rate", "fps", [series("obs", "FPS", (d) => d.activeFps)]],
    [
      "Bitrate",
      "kbps",
      [
        series("obs", "OBS → MediaMTX", (d) => d.stream.kbps),
        series("twitch-relay", "Relay → Twitch", (d) => kbits(d.bitrate)),
      ],
    ],
    [
      "Skipped frames per 5 s",
      "frames",
      [
        increase(series("obs", "Render", (d) => d.renderSkippedFrames)),
        increase(series("obs", "Encoder", (d) => d.outputSkippedFrames)),
        increase(series("obs", "Network", (d) => d.stream.outputSkippedFrames)),
      ],
    ],
    ["Program decoded frame rate", "fps", [series("analyzer", "Decoded", (d) => kbits(d.fps))]],
    ["Revision settle time p95", "ms", [series("server", "p95", (d) => d.settle.p95)]],
    ["Revision lag", "revisions", [series("server", "Lag", (d) => d.lag)]],
    ["Scene switch time", "ms", [series("scene-switch", "Switch", (d) => d.latencyMs)]],
    ["Server event loop delay p99", "ms", [series("server", "p99", (d) => d.loop.p99)]],
    ["Free system memory", "MB", [series("system", "Free", (d) => MB(d.freeBytes))]],
  ];
}

function tiles(data: RunData, series: SeriesOf): [string, string, string][] {
  const obs = data.samples.obs;
  /** A ratio of two counters' growth over the run, as a percentage. */
  const ratio = (
    skipped: (d: SampleData["obs"]) => number,
    total: (d: SampleData["obs"]) => number,
  ) => {
    const first = obs[0]?.data;
    const last = obs.at(-1)?.data;
    if (first === undefined || last === undefined) return "–";
    const all = total(last) - total(first);
    return all > 0 ? `${(((skipped(last) - skipped(first)) / all) * 100).toFixed(3)}%` : "–";
  };
  const count = (source: string, event: string) =>
    data.events.filter((line) => line.source === source && line.event === event).length;
  const exits = data.events.filter(
    (line) => line.event === "exited" && line.detail?.expected !== true,
  );
  const switches = data.samples["scene-switch"].flatMap((sample) => sample.data.latencyMs ?? []);
  const p95 = quantile(switches, 0.95);
  return [
    [
      "Duration",
      `${((data.end - data.start) / 3_600_000).toFixed(2)} h`,
      `${String(obs.length)} OBS samples`,
    ],
    [
      "OBS memory growth",
      slope(series("system", "OBS", (d) => MB(d.groups.obs.private))),
      "private bytes, after the first hour",
    ],
    [
      "Browser pages growth",
      slope(series("system", "Pages", (d) => MB(d.groups["obs-browser"].private))),
      "every obs-browser-page process",
    ],
    [
      "Server heap growth",
      slope(series("server", "Heap", (d) => MB(d.memory.heapUsed))),
      "Node heap used",
    ],
    [
      "MoQ relays growth",
      slope(series("system", "Relays", (d) => MB(d.groups["moq-relays"].private))),
      "moq export processes",
    ],
    [
      "Render lag",
      ratio(
        (d) => d.renderSkippedFrames,
        (d) => d.renderTotalFrames,
      ),
      "frames OBS skipped rendering",
    ],
    [
      "Encoder lag",
      ratio(
        (d) => d.outputSkippedFrames,
        (d) => d.outputTotalFrames,
      ),
      "frames skipped encoding",
    ],
    [
      "Network drops",
      ratio(
        (d) => d.stream.outputSkippedFrames,
        (d) => d.stream.outputTotalFrames,
      ),
      "OBS → MediaMTX",
    ],
    [
      "Scene switch p95",
      p95 === undefined ? "–" : `${String(Math.round(p95))} ms`,
      `${String(switches.length)} switches`,
    ],
    ["Unexpected exits", String(exits.length), "supervised processes"],
    ["Feed freezes", String(count("obs", "feed-frozen")), "a feed's thumbnail stopped changing"],
    [
      "Program freezes",
      String(count("analyzer", "freeze-start")),
      "2 s without change on the program",
    ],
  ];
}

function eventCounts(events: readonly EventLine[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const event of events) {
    const key = `${event.source} ${event.event}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].toSorted((a, b) => b[1] - a[1]);
}

/** The latest 400 events, without the routine ones: source state changes and publisher starts. */
/** One row of the events table, as text. */
interface EventRow {
  readonly time: string;
  readonly source: string;
  readonly event: string;
  readonly detail: string;
}

function notableEvents(events: readonly EventLine[]): EventRow[] {
  return events
    .filter(
      (event) =>
        !(event.source === "server" && event.event === "source-state") &&
        !(event.event === "started" && event.source.startsWith("publisher")),
    )
    .slice(-400)
    .map((event) => ({
      time: new Date(event.t).toISOString().replace("T", " ").slice(0, 19),
      source: event.source,
      event: event.event,
      detail: event.detail === undefined ? "" : JSON.stringify(event.detail).slice(0, 300),
    }));
}

/** Growth per hour by least squares, skipping the first hour while the run is long enough. */
function slope(series: Series): string {
  const span = series.points.at(-1)?.[0] ?? 0;
  const points = series.points.filter(([h]) => span < 2 || h >= 1);
  if (points.length < 3) return "–";
  const n = points.length;
  const mx = points.reduce((sum, [x]) => sum + x, 0) / n;
  const my = points.reduce((sum, [, y]) => sum + y, 0) / n;
  let num = 0;
  let den = 0;
  for (const [x, y] of points) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  if (den === 0) return "–";
  const perHour = num / den;
  return `${perHour >= 0 ? "+" : ""}${perHour.toFixed(1)} MB/h`;
}

function quantile(values: readonly number[], q: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** At most `limit` points: the mean of each bucket, so a day still draws quickly. */
function downsample(points: readonly Point[], limit = 600): Point[] {
  if (points.length <= limit) return [...points];
  const size = points.length / limit;
  const result: Point[] = [];
  for (let i = 0; i < limit; i += 1) {
    const bucket = points.slice(Math.floor(i * size), Math.floor((i + 1) * size));
    if (bucket.length === 0) continue;
    const x = bucket.reduce((sum, [h]) => sum + h, 0) / bucket.length;
    const y = bucket.reduce((sum, [, v]) => sum + v, 0) / bucket.length;
    result.push([x, y]);
  }
  return result;
}

const W = 560;
const H = 180;
const PAD = { left: 52, right: 12, top: 10, bottom: 24 };

/** One small-multiple line chart; hovering shows the nearest value of each series. */
function chart(title: string, unit: string, list: readonly Series[], span: number): string {
  const drawn = list.map((series) => ({ name: series.name, points: downsample(series.points) }));
  const values = drawn.flatMap((series) => series.points.map(([, v]) => v));
  const top = niceMax(Math.max(0, ...values));
  const xMax = Math.max(span, 1 / 60);
  const x = (h: number) => PAD.left + (h / xMax) * (W - PAD.left - PAD.right);
  const y = (v: number) =>
    H - PAD.bottom - (top === 0 ? 0 : (v / top) * (H - PAD.top - PAD.bottom));
  const grid = [0, 0.5, 1]
    .map((f) => {
      const value = top * f;
      return `<line x1="${String(PAD.left)}" x2="${String(W - PAD.right)}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}" class="grid"/><text x="${String(PAD.left - 6)}" y="${(y(value) + 4).toFixed(1)}" class="tick" text-anchor="end">${format(value)}</text>`;
    })
    .join("");
  const xTicks = [0, 0.25, 0.5, 0.75, 1]
    .map(
      (f) =>
        `<text x="${x(xMax * f).toFixed(1)}" y="${String(H - 6)}" class="tick" text-anchor="middle">${(xMax * f).toFixed(1)} h</text>`,
    )
    .join("");
  const lines = drawn
    .map(
      (series, index) =>
        `<polyline class="line s${String(index + 1)}" points="${series.points.map(([h, v]) => `${x(h).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}"/>`,
    )
    .join("");
  const legend =
    drawn.length < 2
      ? ""
      : `<div class="legend">${drawn.map((series, index) => `<span><i class="s${String(index + 1)}"></i>${escape(series.name)}</span>`).join("")}</div>`;
  const empty =
    values.length === 0
      ? `<text x="${String(W / 2)}" y="${String(H / 2)}" class="tick" text-anchor="middle">No data yet</text>`
      : "";
  const data = escape(
    JSON.stringify({
      unit,
      xMax,
      top,
      series: drawn.map((series) => ({
        name: series.name,
        points: series.points.map(([h, v]) => [Number(h.toFixed(4)), Number(v.toFixed(2))]),
      })),
    }),
  );
  return `<figure class="chart"><figcaption>${escape(title)} <span class="unit">${escape(unit)}</span></figcaption>${legend}<div class="plot" data-chart="${data}"><svg viewBox="0 0 ${String(W)} ${String(H)}" role="img" aria-label="${escape(title)}">${grid}${xTicks}${lines}${empty}<line class="cross" y1="${String(PAD.top)}" y2="${String(H - PAD.bottom)}"/></svg><div class="tip" hidden></div></div></figure>`;
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= value) ?? 10;
  return step * magnitude;
}

/** An axis label: `12k`, `340`, `2.50`. */
function format(value: number): string {
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return Number.isInteger(value) ? String(value) : value.toFixed(value < 10 ? 2 : 1);
}

function escape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const HOVER = `
for (const plot of document.querySelectorAll(".plot")) {
  const data = JSON.parse(plot.dataset.chart);
  const svg = plot.querySelector("svg"), cross = plot.querySelector(".cross"), tip = plot.querySelector(".tip");
  const L = ${String(PAD.left)}, R = ${String(W - PAD.right)};
  plot.addEventListener("pointermove", (e) => {
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * ${String(W)};
    if (px < L || px > R) { tip.hidden = true; cross.style.display = "none"; return; }
    const h = ((px - L) / (R - L)) * data.xMax;
    const rows = data.series.map((s) => {
      let best; for (const p of s.points) if (!best || Math.abs(p[0] - h) < Math.abs(best[0] - h)) best = p;
      return best ? "<div>" + s.name + ": <b>" + best[1] + "</b> " + data.unit + "</div>" : "";
    });
    cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.style.display = "block";
    tip.innerHTML = "<div class=when>" + h.toFixed(2) + " h</div>" + rows.join("");
    tip.hidden = false;
    tip.style.left = Math.min(box.width - 170, (px / ${String(W)}) * box.width + 12) + "px";
  });
  plot.addEventListener("pointerleave", () => { tip.hidden = true; cross.style.display = "none"; });
}`;

function page(
  tiles: readonly [string, string, string][],
  charts: readonly string[],
  counts: readonly [string, number][],
  events: readonly EventRow[],
  startedAt: string,
): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Vignette soak report</title>
<style>
.viz-root { color-scheme: light; --surface-1: #fcfcfb; --surface-2: #f3f2ef; --text-primary: #0b0b0b; --text-secondary: #52514e; --grid: #e4e3df; --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; }
@media (prefers-color-scheme: dark) { .viz-root { color-scheme: dark; --surface-1: #1a1a19; --surface-2: #232321; --text-primary: #f0efec; --text-secondary: #c3c2b7; --grid: #34332f; --s1: #3987e5; --s2: #d95926; --s3: #199e70; } }
body { margin: 0; font: 14px/1.4 system-ui, sans-serif; }
.viz-root { background: var(--surface-1); color: var(--text-primary); padding: 24px; min-height: 100vh; box-sizing: border-box; }
h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 32px 0 12px; } .sub { color: var(--text-secondary); margin: 0 0 20px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
.tile { background: var(--surface-2); border-radius: 8px; padding: 12px 14px; } .tile .k { color: var(--text-secondary); font-size: 12px; } .tile .v { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; } .tile .d { color: var(--text-secondary); font-size: 12px; }
.charts { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 20px; }
.chart { margin: 0; } figcaption { font-weight: 600; margin-bottom: 4px; } .unit { color: var(--text-secondary); font-weight: 400; }
.plot { position: relative; } svg { width: 100%; height: auto; display: block; }
.grid { stroke: var(--grid); stroke-width: 1; } .tick { fill: var(--text-secondary); font-size: 11px; }
.line { fill: none; stroke-width: 2; stroke-linejoin: round; } .line.s1 { stroke: var(--s1); } .line.s2 { stroke: var(--s2); } .line.s3 { stroke: var(--s3); }
.cross { stroke: var(--text-secondary); stroke-width: 1; display: none; }
.legend { display: flex; gap: 14px; color: var(--text-secondary); font-size: 12px; margin-bottom: 4px; } .legend i { display: inline-block; width: 12px; height: 3px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
.legend i.s1 { background: var(--s1); } .legend i.s2 { background: var(--s2); } .legend i.s3 { background: var(--s3); }
.tip { position: absolute; top: 8px; background: var(--surface-2); border: 1px solid var(--grid); border-radius: 6px; padding: 6px 8px; font-size: 12px; pointer-events: none; min-width: 140px; } .tip .when { color: var(--text-secondary); }
table { border-collapse: collapse; width: 100%; font-size: 12px; } td, th { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--grid); vertical-align: top; } th { color: var(--text-secondary); font-weight: 500; }
td.detail { font-family: ui-monospace, monospace; word-break: break-all; color: var(--text-secondary); }
</style></head><body><main class="viz-root">
<h1>Vignette soak report</h1><p class="sub">Run started ${escape(startedAt)} · generated ${escape(new Date().toISOString())}</p>
<div class="tiles">${tiles.map(([k, v, d]) => `<div class="tile"><div class="k">${escape(k)}</div><div class="v">${escape(v)}</div><div class="d">${escape(d)}</div></div>`).join("")}</div>
<h2>Measurements</h2><div class="charts">${charts.join("")}</div>
<h2>Event counts</h2><table><tr><th>Event</th><th>Count</th></tr>${counts.map(([k, n]) => `<tr><td>${escape(k)}</td><td>${String(n)}</td></tr>`).join("")}</table>
<h2>Events (latest 400, without source state changes)</h2><table><tr><th>Time (UTC)</th><th>Source</th><th>Event</th><th>Detail</th></tr>${events.map((row) => `<tr><td>${escape(row.time)}</td><td>${escape(row.source)}</td><td>${escape(row.event)}</td><td class="detail">${escape(row.detail)}</td></tr>`).join("")}</table>
</main><script>${HOVER}</script></body></html>`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (dir === undefined) {
    console.error("Usage: node dist/harness/report.js <run directory>");
    process.exit(1);
  }
  await writeReport(dir);
  console.log(join(dir, "report.html"));
}
