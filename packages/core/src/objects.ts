/** Recursively freezes plain data (objects and arrays) in place and returns it. */
export function deepFreeze<T>(value: T): T {
  if (
    value !== null &&
    value !== undefined &&
    Object(value) === value &&
    !(value instanceof Function) &&
    !Object.isFrozen(value)
  ) {
    // oxlint-disable-next-line house/no-object-freeze -- Compiled snapshots and cloned authoring inputs cross ownership boundaries.
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Removes `undefined`-valued properties so the result satisfies targets compiled with
 * `exactOptionalPropertyTypes`.
 */
export type DefinedProperties<T> = { [K in keyof T]: Exclude<T[K], undefined> };

export function omitUndefined<T extends object>(value: T): DefinedProperties<T> {
  // SAFETY: Filtering removes only undefined values and preserves every remaining key and value.
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as DefinedProperties<T>;
}
