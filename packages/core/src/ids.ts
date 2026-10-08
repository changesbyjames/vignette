const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/** Human-readable rule enforced by {@link isStableId}, shared by diagnostics and wire decoding. */
export const STABLE_ID_RULE =
  "ID must start with an alphanumeric character and contain only letters, numbers, '.', '_' or '-'.";

/**
 * Tests whether a string follows the stable ID syntax.
 *
 * Authoring validation reports violations as `INVALID_*_ID` diagnostics, so callers never need to
 * check IDs before rendering.
 */
export function isStableId(value: string): boolean {
  return ID_PATTERN.test(value);
}
