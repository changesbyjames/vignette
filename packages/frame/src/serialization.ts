export function serializeFrameParams(value: unknown): string {
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

function toJsonValue(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Frame parameters must contain finite numbers.");
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError("Frame parameters must be JSON-serializable objects.");
  }
  if (ancestors.has(value)) throw new TypeError("Frame parameters must not contain cycles.");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => toJsonValue(item, ancestors));
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Frame parameters may contain only plain objects and arrays.");
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = toJsonValue((value as Record<string, unknown>)[key], ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}
