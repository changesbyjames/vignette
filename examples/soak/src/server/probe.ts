import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import process from "node:process";
import type { Composer, Target, TargetStatus } from "vignette";

/** What the server tells the harness: a periodic sample, or one thing that happened. */
export type ProbeMessage = ProbeSampleMessage | ProbeEventMessage;

export interface ProbeSampleMessage {
  readonly type: "sample";
  readonly sample: ServerSample;
}

export interface ProbeEventMessage {
  readonly type: "event";
  readonly event: string;
  readonly detail?: EventDetail;
}

/** An event's particulars: flat, so they log as one JSON line. */
export type EventDetail = Readonly<Record<string, string | number | boolean | null | undefined>>;

/** Event loop delay over a window, in milliseconds. */
export interface LoopDelay {
  readonly p50: number;
  readonly p99: number;
  readonly max: number;
}

/**
 * Time from a revision's commit to the target settling it, for revisions settled in a window.
 * `coalesced` counts revisions the target never settled alone because a newer one overtook them.
 */
export interface SettleTimes {
  readonly count: number;
  readonly coalesced: number;
  readonly p50?: number;
  readonly p95?: number;
  readonly max?: number;
}

/** How many sources are in each handle state. */
export interface SourceCounts {
  live: number;
  preparing: number;
  error: number;
}

export interface ServerSample {
  readonly memory: NodeJS.MemoryUsage;
  readonly loop: LoopDelay;
  /** Event loop utilisation over the window, 0–1. */
  readonly utilisation: number;
  readonly resources: number;
  /** Composer revision minus the target's settled revision, at the end of the window. */
  readonly lag: number;
  readonly composed?: number;
  readonly settled?: number;
  readonly settle: SettleTimes;
  readonly phase: string;
  readonly connection?: string;
  readonly sources: Readonly<SourceCounts>;
}

const SAMPLE_MS = 5_000;

/**
 * Watches the composer and the target: timestamps every committed revision, measures how long the
 * target takes to settle it, reports status transitions as events, and samples memory and the
 * event loop every five seconds. Returns a stop function.
 */
export function startProbe(
  composer: Composer,
  target: Target,
  send: (message: ProbeMessage) => void,
): () => void {
  const committedAt = new Map<number, number>();
  let latencies: number[] = [];
  let coalesced = 0;
  let lastRevision: number | undefined = undefined;
  let lastScene: string | undefined = undefined;

  const unsubscribeComposer = composer.subscribe(() => {
    const snapshot = composer.snapshot;
    if (snapshot === undefined || snapshot.revision === lastRevision) return;
    lastRevision = snapshot.revision;
    committedAt.set(snapshot.revision, performance.now());
    if (snapshot.activeScene !== lastScene) {
      lastScene = snapshot.activeScene;
      send({
        type: "event",
        event: "scene-requested",
        detail: { scene: lastScene, revision: snapshot.revision },
      });
    }
  });

  let previous = target.status;
  const unsubscribeTarget = target.subscribe(() => {
    // Times the newly settled revision, and reports what changed since the last status.
    const status = target.status;
    const settled = status.revision.settled;
    if (settled !== undefined && settled !== previous.revision.settled) {
      const now = performance.now();
      // Every revision up to the settled one is done; only the settled one settled on its own.
      for (const [revision, at] of committedAt) {
        if (revision > settled) continue;
        if (revision === settled) latencies.push(now - at);
        else coalesced += 1;
        committedAt.delete(revision);
      }
    }
    for (const event of transitions(previous, status)) send(event);
    previous = status;
  });

  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  let utilisation = performance.eventLoopUtilization();
  const timer = setInterval(() => {
    const status = target.status;
    const window = latencies.toSorted((a, b) => a - b);
    const nextUtilisation = performance.eventLoopUtilization();
    send({
      type: "sample",
      sample: {
        memory: process.memoryUsage(),
        loop: {
          p50: loop.percentile(50) / 1e6,
          p99: loop.percentile(99) / 1e6,
          max: loop.max / 1e6,
        },
        utilisation: performance.eventLoopUtilization(nextUtilisation, utilisation).utilization,
        resources: process.getActiveResourcesInfo().length,
        lag: (lastRevision ?? 0) - (status.revision.settled ?? 0),
        composed: lastRevision,
        settled: status.revision.settled,
        settle: {
          count: window.length,
          coalesced,
          p50: percentile(window, 0.5),
          p95: percentile(window, 0.95),
          max: window.at(-1),
        },
        phase: status.phase,
        connection: status.connection?.phase,
        sources: countSources(status),
      },
    });
    utilisation = nextUtilisation;
    loop.reset();
    latencies = [];
    coalesced = 0;
  }, SAMPLE_MS);

  return () => {
    clearInterval(timer);
    loop.disable();
    unsubscribeComposer();
    unsubscribeTarget();
  };
}

/** Events for what changed between two statuses: phase, connection, and each source's state. */
function transitions(before: TargetStatus, after: TargetStatus): ProbeEventMessage[] {
  const events: ProbeEventMessage[] = [];
  if (before.phase !== after.phase && !routine(before.phase, after.phase)) {
    events.push({
      type: "event",
      event: "target-phase",
      detail: { from: before.phase, to: after.phase, error: after.error?.message },
    });
  }
  const connection = connectionChange(before, after);
  if (connection) events.push(connection);
  return [...events, ...sourceChanges(before, after)];
}

/** Every revision goes settled → synchronising → settled; samples count those, events do not. */
function routine(from: string, to: string): boolean {
  const pair = new Set([from, to]);
  return pair.has("settled") && pair.has("synchronising");
}

/** A `target-connection` event when the connection phase changed. */
function connectionChange(
  before: TargetStatus,
  after: TargetStatus,
): ProbeEventMessage | undefined {
  const from = before.connection?.phase;
  const to = after.connection?.phase;
  if (from === to) return undefined;
  return {
    type: "event",
    event: "target-connection",
    detail: { from, to, error: after.connection?.error?.message },
  };
}

/** A `source-state` event per source whose handle state changed, appeared or went away. */
function sourceChanges(before: TargetStatus, after: TargetStatus): ProbeEventMessage[] {
  const ids = new Set([...Object.keys(before.sources), ...Object.keys(after.sources)]);
  return [...ids].flatMap((id) => {
    const from = before.sources[id];
    const to = after.sources[id];
    if (from === to) return [];
    return [
      {
        type: "event",
        event: "source-state",
        detail: { id, from, to, error: after.sourceErrors[id]?.message },
      } as const,
    ];
  });
}

function countSources(status: TargetStatus): SourceCounts {
  const counts: SourceCounts = { live: 0, preparing: 0, error: 0 };
  for (const state of Object.values(status.sources)) counts[state] += 1;
  return counts;
}

function percentile(sorted: readonly number[], p: number): number | undefined {
  if (sorted.length === 0) return undefined;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}
