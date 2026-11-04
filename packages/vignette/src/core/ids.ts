import { z } from "zod";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/** Human-readable rule enforced by {@link isStableId}, shared by diagnostics and wire decoding. */
export const STABLE_ID_RULE =
  "ID must start with an alphanumeric character and contain only letters, numbers, '.', '_' or '-'.";

/**
 * Tests whether a string follows the stable ID syntax. Show, scene, layer and source IDs all use
 * it; derived IDs join path segments with `.` so they satisfy it too.
 */
export function isStableId(value: string): boolean {
  return ID_PATTERN.test(value);
}

/** A show, scene, layer or source ID; malformed IDs fail decoding instead of throwing later. */
export const StableIdSchema = z.string().refine(isStableId, STABLE_ID_RULE);
/** A show, scene, layer or source ID. */
export type StableId = z.output<typeof StableIdSchema>;
