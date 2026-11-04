import { createWriteStream, mkdirSync, writeFileSync, type WriteStream } from "node:fs";
import { join } from "node:path";

import type { EventDetail, Probe, RunStatus, SampleData } from "./samples.js";

/**
 * A run directory: `samples.jsonl` and `events.jsonl`, `logs/` for each process's output, and
 * `status.json`, the latest of everything, for a quick look while the run goes on. Strings in
 * `secrets` are redacted from everything written.
 */
export interface Run {
  readonly dir: string;
  readonly startedAt: number;
  sample<P extends Probe>(probe: P, data: SampleData[P]): void;
  event(source: string, event: string, detail?: EventDetail): void;
  /** A log file under `logs/` for one process's output; redacted like the rest. */
  log(name: string): (chunk: string) => void;
  /** Merges `patch` into `status.json`. */
  status(patch: RunStatus): void;
  redact(secret: string): void;
  close(): Promise<void>;
}

export function openRun(dir: string): Run {
  mkdirSync(join(dir, "logs"), { recursive: true });
  const startedAt = Date.now();
  const secrets: string[] = [];
  const clean = (text: string) =>
    secrets.reduce((result, secret) => result.replaceAll(secret, "<redacted>"), text);
  const streams: WriteStream[] = [];
  const open = (path: string) => {
    const stream = createWriteStream(path, { flags: "a" });
    streams.push(stream);
    return stream;
  };
  const samples = open(join(dir, "samples.jsonl"));
  const events = open(join(dir, "events.jsonl"));
  const logs = new Map<string, WriteStream>();
  let status: RunStatus = { startedAt: new Date(startedAt).toISOString() };

  return {
    dir,
    startedAt,
    sample(probe, data) {
      samples.write(`${clean(JSON.stringify({ t: Date.now(), probe, data }))}\n`);
    },
    event(source, event, detail) {
      const line = clean(JSON.stringify({ t: Date.now(), source, event, detail }));
      events.write(`${line}\n`);
      console.log(line);
    },
    log(name) {
      return (chunk) => {
        let stream = logs.get(name);
        if (stream === undefined) {
          stream = open(join(dir, "logs", `${name}.log`));
          logs.set(name, stream);
        }
        stream.write(clean(chunk));
      };
    },
    status(patch) {
      status = { ...status, ...patch, updatedAt: new Date().toISOString() };
      writeFileSync(join(dir, "status.json"), clean(JSON.stringify(status, undefined, 2)));
    },
    redact(secret) {
      if (secret !== "") secrets.push(secret);
    },
    async close() {
      await Promise.all(streams.map((stream) => new Promise((resolve) => stream.end(resolve))));
    },
  };
}
