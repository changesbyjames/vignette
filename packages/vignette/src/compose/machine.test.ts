import { describe, expect, it } from "vitest";
import { createActor, fromPromise } from "xstate";

import type { Snapshot } from "../core/snapshot.js";
import { composerMachine, type CompileResult } from "./machine.js";

/** One compile the machine started, finished by the test. */
interface CompileCall {
  readonly identity: Snapshot | undefined;
  readonly finish: (result: CompileResult) => void;
}

/** The machine with a fake compile, and what its actions saw. */
function harness() {
  const compiles: CompileCall[] = [];
  const published: number[] = [];
  const reported: string[] = [];
  let closed = false;
  const machine = composerMachine.provide({
    actors: {
      compile: fromPromise(
        ({ input }) =>
          new Promise<CompileResult>((finish) => {
            compiles.push({ identity: input, finish });
          }),
      ),
    },
    actions: {
      publish: (_, snapshot) => {
        published.push(snapshot.revision);
      },
      report: (_, error) => {
        reported.push(error.message);
      },
      close: () => {
        closed = true;
      },
    },
  });
  const actor = createActor(machine);
  actor.start();
  return {
    actor,
    compiles,
    published,
    reported,
    commit: (revision: number) => {
      actor.send({ type: "committed", revision });
    },
    /** Finishes the latest compile and lets its result arrive. */
    finish: async (result: CompileResult) => {
      compiles.at(-1)?.finish(result);
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    get closed() {
      return closed;
    },
  };
}

function compiled(revision: number): CompileResult {
  return { ok: true, revision, snapshot: snapshot(revision), diagnostics: [] };
}

function failed(revision: number, message = "invalid"): CompileResult {
  return { ok: false, revision, error: new Error(message), diagnostics: [] };
}

function snapshot(revision: number): Snapshot {
  return { revision, id: "show", canvas: { width: 1280, height: 720 }, sources: [], scenes: [] };
}

describe("composer machine", () => {
  it("runs one compile at a time and coalesces commits made during it", async () => {
    const composer = harness();
    composer.commit(1);
    composer.commit(2);
    composer.commit(3);
    expect(composer.compiles).toHaveLength(1);
    expect(composer.actor.getSnapshot().value).toBe("compiling");

    // The compile read the latest commit, so nothing is behind.
    await composer.finish(compiled(3));
    expect(composer.compiles).toHaveLength(1);
    expect(composer.actor.getSnapshot().value).toBe("ready");
    expect(composer.published).toEqual([3]);
  });

  it("compiles again when a compile finishes behind the latest commit", async () => {
    const composer = harness();
    composer.commit(1);
    composer.commit(2);
    await composer.finish(compiled(1));
    expect(composer.published).toEqual([1]);
    expect(composer.compiles).toHaveLength(2);
    expect(composer.compiles[1]?.identity).toEqual(snapshot(1));
    expect(composer.actor.getSnapshot().context).toMatchObject({
      commitRevision: 2,
      compiledRevision: 1,
    });

    await composer.finish(compiled(2));
    expect(composer.actor.getSnapshot().value).toBe("ready");
  });

  it("keeps the last snapshot on a failed compile, reports it, and recovers", async () => {
    const composer = harness();
    composer.commit(1);
    await composer.finish(compiled(1));
    composer.commit(2);
    await composer.finish(failed(2));

    expect(composer.actor.getSnapshot().value).toBe("error");
    expect(composer.actor.getSnapshot().context).toMatchObject({
      snapshot: snapshot(1),
      failure: { revision: 2 },
    });
    expect(composer.reported).toEqual(["invalid"]);

    composer.commit(3);
    await composer.finish(compiled(3));
    expect(composer.actor.getSnapshot().value).toBe("ready");
    expect(composer.actor.getSnapshot().context.failure).toBeUndefined();
  });

  it("does not let a stale compile replace a render error", async () => {
    const composer = harness();
    composer.commit(1);
    composer.actor.send({ type: "renderFailed", revision: 1, error: new Error("boom") });
    expect(composer.actor.getSnapshot().value).toBe("error");

    // The compile in flight was stopped; its result never arrives.
    await composer.finish(failed(1, "no <Show>"));
    expect(composer.reported).toEqual(["boom"]);
    expect(composer.actor.getSnapshot().context.failure?.error.message).toBe("boom");
  });

  it("closes the hub on dispose and ignores everything after", async () => {
    const composer = harness();
    composer.commit(1);
    composer.actor.send({ type: "dispose" });
    expect(composer.closed).toBe(true);
    expect(composer.actor.getSnapshot().status).toBe("done");

    await composer.finish(compiled(1));
    expect(composer.published).toEqual([]);
  });
});
