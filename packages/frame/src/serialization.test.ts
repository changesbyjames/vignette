import { describe, expect, it } from "vitest";

import { serializeFrameParams } from "./serialization.js";

describe("frame parameter serialization", () => {
  it("canonicalizes object keys recursively", () => {
    expect(serializeFrameParams({ z: 1, nested: { b: true, a: "first" }, a: 2 })).toBe(
      '{"a":2,"nested":{"a":"first","b":true},"z":1}',
    );
  });

  it("rejects cycles and non-plain objects", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => serializeFrameParams(cyclic)).toThrow(/cycles/u);
    expect(() => serializeFrameParams({ date: new Date() })).toThrow(/plain objects/u);
  });
});
