import { projectId } from "@cbj/vignette-core";
import { describe, expect, it } from "vitest";

import { registrySceneName } from "./naming.js";
import { validateOperationDependencies, type CreateSceneOperation } from "./operations.js";

describe("validateOperationDependencies", () => {
  it("rejects duplicate, missing, same-phase forward, and cyclic dependencies", () => {
    const first = createScene("first", ["second"]);
    const second = createScene("second", ["first"]);
    const errors = [
      ...validateOperationDependencies([first, second]),
      ...validateOperationDependencies([
        createScene("duplicate", []),
        createScene("duplicate", ["missing"]),
      ]),
    ];

    expect(errors.some((message) => message.includes("Duplicate operation key"))).toBe(true);
    expect(errors.some((message) => message.includes("depends on missing"))).toBe(true);
    expect(errors.some((message) => message.includes("same-phase forward"))).toBe(true);
    expect(errors.some((message) => message.includes("Dependency cycle"))).toBe(true);
  });
});

function createScene(key: string, dependsOn: readonly string[]): CreateSceneOperation {
  return {
    kind: "create-scene",
    key,
    phase: "scenes",
    dependsOn,
    destructive: false,
    scene: { kind: "registry" },
    sceneName: registrySceneName(projectId("dependency-test")),
  };
}
