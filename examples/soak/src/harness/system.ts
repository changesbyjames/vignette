import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

import type { GroupName, GroupSample } from "./samples.js";

const exec = promisify(execFile);

/** One Windows process, from `Win32_Process`. Times are in 100 ns units, sizes in bytes. */
const ProcessInfoSchema = z.object({
  ProcessId: z.number(),
  ParentProcessId: z.number(),
  Name: z.string(),
  ExecutablePath: z.string().nullable(),
  CommandLine: z.string().nullable(),
  WorkingSetSize: z.number(),
  PrivatePageCount: z.number(),
  HandleCount: z.number(),
  ThreadCount: z.number(),
  KernelModeTime: z.number(),
  UserModeTime: z.number(),
});
export type ProcessInfo = z.output<typeof ProcessInfoSchema>;

const SnapshotSchema = z.object({
  freeKb: z.number(),
  totalKb: z.number(),
  processes: z.array(ProcessInfoSchema),
});
type Snapshot = z.output<typeof SnapshotSchema>;

const QUERY = [
  "$ErrorActionPreference='SilentlyContinue';",
  "$os = Get-CimInstance Win32_OperatingSystem;",
  "$p = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,WorkingSetSize,PrivatePageCount,HandleCount,ThreadCount,KernelModeTime,UserModeTime;",
  "@{ freeKb = [double]$os.FreePhysicalMemory; totalKb = [double]$os.TotalVisibleMemorySize; processes = @($p) } | ConvertTo-Json -Compress -Depth 3",
].join(" ");

export interface SystemSnapshot {
  readonly freeBytes: number;
  readonly totalBytes: number;
  readonly processes: readonly ProcessInfo[];
}

/** Every process on the machine and the free physical memory, in one PowerShell call. */
export async function systemSnapshot(): Promise<SystemSnapshot> {
  const { stdout } = await exec(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", QUERY],
    { maxBuffer: 64 * 1024 * 1024, windowsHide: true },
  );
  const parsed: Snapshot = SnapshotSchema.parse(JSON.parse(stdout));
  return {
    freeBytes: parsed.freeKb * 1024,
    totalBytes: parsed.totalKb * 1024,
    processes: parsed.processes,
  };
}

export type GroupMatchers = Readonly<Record<GroupName, (info: ProcessInfo) => boolean>>;

/**
 * Sums processes into named groups, and works out each group's CPU use since the previous call
 * from the processes' accumulated CPU time. A process new since then counts from zero.
 */
export function grouper(): (
  snapshot: SystemSnapshot,
  groups: GroupMatchers,
) => Record<GroupName, GroupSample> {
  let previous: CpuTimes | undefined = undefined;
  return (snapshot, groups) => {
    const at = Date.now();
    const times = new Map<number, number>();
    const elapsed = previous === undefined ? 0 : at - previous.at;
    const sum = (matches: (info: ProcessInfo) => boolean): GroupSample => {
      // Each member's CPU time since the previous call, or since it started if it is new.
      const members = snapshot.processes.filter(matches);
      let ticks = 0;
      for (const info of members) {
        const time = info.KernelModeTime + info.UserModeTime;
        times.set(info.ProcessId, time);
        ticks += time - (previous?.times.get(info.ProcessId) ?? 0);
      }
      const total = (pick: (info: ProcessInfo) => number) =>
        members.reduce((result, info) => result + pick(info), 0);
      return {
        count: members.length,
        workingSet: total((info) => info.WorkingSetSize),
        private: total((info) => info.PrivatePageCount),
        handles: total((info) => info.HandleCount),
        threads: total((info) => info.ThreadCount),
        cpu: elapsed > 0 ? (ticks / 1e4 / elapsed) * 100 : undefined,
      };
    };
    const result = Object.fromEntries(
      Object.entries(groups).map(([name, matches]) => [name, sum(matches)]),
    );
    previous = { at, times };
    // SAFETY: `result` has one entry per key of `groups`, which is a `Record<GroupName, …>`.
    return result as Record<GroupName, GroupSample>;
  };
}

interface CpuTimes {
  readonly at: number;
  readonly times: ReadonlyMap<number, number>;
}

/** Force-kills processes by ID, ignoring ones already gone. */
export function killProcesses(ids: readonly number[]): void {
  for (const id of ids) {
    try {
      process.kill(id);
    } catch {
      // Already exited.
    }
  }
}
