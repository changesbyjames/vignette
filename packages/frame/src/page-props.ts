import { z } from "zod";
import type { CompiledSnapshot } from "@strangecyan/vignette-core";

import {
  FrameJsonValueSchema,
  type FrameJsonObject,
  type FrameJsonValue,
} from "./serialization.js";

const PageSourcesSchema = z.object({
  sources: z.array(
    z.object({
      id: z.string(),
      definition: z.looseObject({
        kind: z.string(),
        props: z.record(z.string(), FrameJsonValueSchema).optional(),
      }),
    }),
  ),
});
export type PageSources = z.output<typeof PageSourcesSchema>;

/**
 * The live props a snapshot holds for one browser source, or undefined when the snapshot does not
 * place that source with props. Accepts a compiled snapshot or its decoded JSON.
 */
export function pageProps(
  snapshot: CompiledSnapshot | FrameJsonValue | undefined,
  sourceId: string,
): FrameJsonObject | undefined {
  const parsed = PageSourcesSchema.safeParse(snapshot);
  if (!parsed.success) return undefined;
  const definition = parsed.data.sources.find((source) => source.id === sourceId)?.definition;
  return definition?.kind === "source:browser" ? definition.props : undefined;
}
