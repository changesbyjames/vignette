import { describe, expect, it } from "vitest";

import { toFrameProps } from "./serialization.js";

interface Cyclic {
  self?: unknown;
}

describe("frame props", () => {
  it("canonicalizes object keys recursively", () => {
    expect(JSON.stringify(toFrameProps({ z: 1, nested: { b: true, a: "first" }, a: 2 }))).toBe(
      '{"a":2,"nested":{"a":"first","b":true},"z":1}',
    );
  });

  it("rejects cycles, non-plain objects, and non-object roots", () => {
    const cyclic: Cyclic = {};
    cyclic.self = cyclic;
    expect(() => toFrameProps(cyclic)).toThrow(/cycles/u);
    expect(() => toFrameProps({ date: new Date() })).toThrow(/plain objects/u);
    expect(() => toFrameProps([1, 2])).toThrow(/JSON object/u);
  });
});
