import { z } from "zod";

export const FrameJsonValueSchema = z.json();
export type FrameJsonValue = z.output<typeof FrameJsonValueSchema>;
export type FrameJsonObject = Record<string, FrameJsonValue>;

/** Validate every value before canonicalizing keys; preserve cycle detection on original objects. */
export function serializeFrameParams(
  value: Parameters<typeof FrameJsonValueSchema.parse>[0],
): string {
  return JSON.stringify(toJsonValue(value, new Set<object>()));
}

export function hashFrameValue(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Only ancestors count as cycles: shared sibling references are serialized independently. */
function toJsonValue(
  value: Parameters<typeof FrameJsonValueSchema.parse>[0],
  ancestors: Set<object>,
): FrameJsonValue {
  const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]).safeParse(value);
  if (scalar.success) return scalar.data;
  if (isNonFiniteNumber(value))
    throw new TypeError("Frame parameters must contain finite numbers.");
  if (value === undefined || value === null || Object(value) !== value || value instanceof Function)
    throw new TypeError("Frame parameters must be JSON-serializable objects.");
  if (ancestors.has(value)) throw new TypeError("Frame parameters must not contain cycles.");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => toJsonValue(item, ancestors));
    return toJsonObject(value, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

/** Reject class instances before traversing a plain object's sorted own entries. */
function toJsonObject(
  value: NonNullable<Parameters<typeof FrameJsonValueSchema.parse>[0]>,
  ancestors: Set<object>,
) {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError("Frame parameters may contain only plain objects and arrays.");
  const result: FrameJsonObject = {};
  const entries = Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  for (const [key, child] of entries) result[key] = toJsonValue(child, ancestors);
  return result;
}

/** Keep non-finite number errors separate from unsupported object errors. */
function isNonFiniteNumber(value: Parameters<typeof FrameJsonValueSchema.parse>[0]): boolean {
  return Number.isNaN(value) || value === Infinity || value === -Infinity;
}
