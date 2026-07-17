import { renderToString } from "react-dom/server";
import { Suspense, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useRemoteStore } from "./remote-store-client.js";
import { defineRemoteStore } from "./remote-store.js";

interface TestStore {
  getSnapshot(): { readonly context: { readonly title: string } };
}

describe("useRemoteStore", () => {
  afterEach(() => {
    FakeEventSource.instances.length = 0;
    vi.unstubAllGlobals();
  });

  it("suspends until the first snapshot and reuses the connection by URL", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("EventSource", FakeEventSource);
    const url = `/api/store/client-test-${crypto.randomUUID()}`;
    const ref = defineRemoteStore<TestStore>({ id: "composition", url });

    expect(render(ref)).toContain("Waiting");
    expect(FakeEventSource.instances).toHaveLength(1);

    FakeEventSource.instances[0]?.emit('{"context":{"title":"Live"}}');

    expect(render(ref)).toContain("Live");
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("ignores malformed messages while waiting for a snapshot", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("EventSource", FakeEventSource);
    const ref = defineRemoteStore<TestStore>({
      id: "composition",
      url: `/api/store/malformed-test-${crypto.randomUUID()}`,
    });

    render(ref);
    FakeEventSource.instances[0]?.emit("not json");

    expect(render(ref)).toContain("Waiting");
  });
});

function render(ref: ReturnType<typeof defineRemoteStore<TestStore>>): string {
  function Selection(): ReactElement {
    const title = useRemoteStore(ref, (snapshot) => snapshot.context.title);
    return <span>{title}</span>;
  }

  return renderToString(
    <Suspense fallback={<span>Waiting</span>}>
      <Selection />
    </Suspense>,
  );
}

class FakeEventSource {
  static readonly instances: FakeEventSource[] = [];
  onmessage: ((event: { readonly data: string }) => void) | null = null;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  emit(data: string): void {
    this.onmessage?.({ data });
  }
}
