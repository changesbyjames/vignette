import { z } from "zod";

/** Where React's development build files a measure: its own tracks are named with ` ⚛`. */
const ReactMeasureDetailSchema = z.object({
  devtools: z.object({ track: z.string().optional(), trackGroup: z.string().optional() }),
});
type ReactMeasureDetail = z.output<typeof ReactMeasureDetailSchema>;

/**
 * Clears the performance measures React's development build records for every component render
 * (its "Components ⚛" and "Scheduler ⚛" tracks). A browser's DevTools reads them; a server keeps
 * them in its performance timeline forever, so a show that commits every second grows by about
 * 130 KB a commit. Measures are cleared by name, so a name the host also measures under is kept.
 */
export function clearReactMeasures(): void {
  if (!("performance" in globalThis)) return;
  const reactNames = new Set<string>();
  const hostNames = new Set<string>();
  for (const entry of performance.getEntriesByType("measure")) {
    if (!(entry instanceof PerformanceMeasure)) continue;
    const detail = ReactMeasureDetailSchema.safeParse(entry.detail);
    (detail.success && isReactTrack(detail.data) ? reactNames : hostNames).add(entry.name);
  }
  for (const name of reactNames) {
    if (!hostNames.has(name)) performance.clearMeasures(name);
  }
}

function isReactTrack({ devtools }: ReactMeasureDetail): boolean {
  return [devtools.track, devtools.trackGroup].some((name) => name?.endsWith(" ⚛") === true);
}
