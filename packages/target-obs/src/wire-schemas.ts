import { z } from "zod";

/** JSON objects decoded at the obs-websocket transport boundary. */
export const ObsWireObjectSchema = z.record(z.string(), z.json());
export type ObsWireObject = z.output<typeof ObsWireObjectSchema>;

/** Transform fields used by convergence comparisons; OBS may send additional JSON fields. */
export const ObsWireTransformSchema = z
  .object({
    positionX: z.number(),
    positionY: z.number(),
    rotation: z.number(),
    alignment: z.number(),
    boundsType: z.string(),
    boundsAlignment: z.number(),
    boundsWidth: z.number(),
    boundsHeight: z.number(),
    cropTop: z.number(),
    cropRight: z.number(),
    cropBottom: z.number(),
    cropLeft: z.number(),
  })
  .catchall(z.json());
export type ObsWireTransform = z.output<typeof ObsWireTransformSchema>;
