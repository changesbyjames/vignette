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
