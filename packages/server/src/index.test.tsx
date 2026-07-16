import { projectId, sceneId, type AssetManifest, type SnapshotRuntime } from "@cbj/vignette-core";
import { Broadcast, Scene } from "@cbj/vignette";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { ComposerErrorEvent, createComposerHost } from "./index.js";

const manifest: AssetManifest = Object.freeze({ version: 1, assets: Object.freeze([]) });

describe("createComposerHost", () => {
  it("shares concurrent start and close work and disposes each connected runtime once", async () => {
    const dispose = vi.fn(() => Promise.resolve());
    const runtime = makeRuntime({ dispose });
    const scene = vi.fn(() => Promise.resolve(show()));
    const host = createHost({ scene });
    host.connect(runtime);

    const firstStart = host.start();
    const secondStart = host.start();
    expect(secondStart).toBe(firstStart);
    await Promise.all([firstStart, secondStart]);

    const firstClose = host.close();
    const secondClose = host.close();
    expect(secondClose).toBe(firstClose);
    await Promise.all([firstClose, secondClose]);

    expect(scene).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    await expect(host.start()).resolves.toBeUndefined();
    expect(scene).toHaveBeenCalledOnce();
  });

  it("does not render when close wins an in-flight scene load", async () => {
    const SceneSpy = vi.fn(() => show());
    let resolveScene: ((element: ReactElement) => void) | undefined;
    const scene = () =>
      new Promise<ReactElement>((resolve) => {
        resolveScene = resolve;
      });
    const host = createHost({ scene });

    const started = host.start();
    const closed = host.close();
    resolveScene?.(<SceneSpy />);
    await Promise.all([started, closed]);

    expect(SceneSpy).not.toHaveBeenCalled();
  });

  it("feeds connected runtimes setup before the first snapshot update", async () => {
    const messages: string[] = [];
    const runtime = makeRuntime({
      setup: vi.fn(() => {
        messages.push("setup");
        return Promise.resolve();
      }),
      update: vi.fn(() => {
        messages.push("update");
      }),
    });
    const host = createHost();
    host.connect(runtime);

    expect(messages).toEqual([]);
    await host.start();
    await vi.waitFor(() => {
      expect(messages).toEqual(["setup", "update"]);
    });
    await host.close();
  });

  it("immediately replays setup and the latest update to runtimes connected after startup", async () => {
    const messages: string[] = [];
    const host = createHost();
    await host.start();

    host.connect(
      makeRuntime({
        setup: () => {
          messages.push("setup");
          return Promise.resolve();
        },
        update: () => {
          messages.push("update");
        },
      }),
    );

    await vi.waitFor(() => {
      expect(messages).toEqual(["setup", "update"]);
    });
    await host.close();
  });

  it("rejects connecting a runtime to a closed host", async () => {
    const host = createHost();
    await host.close();

    expect(() => {
      host.connect(makeRuntime());
    }).toThrow("Composer host is closed.");
  });

  it("dispatches normalized error events for asynchronous runtime consumer failures", async () => {
    const onError = vi.fn<(event: ComposerErrorEvent) => void>();
    const runtime = makeRuntime({
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Verifies normalization of non-Error failures.
      setup: () => Promise.reject("setup failed"),
    });
    const host = createHost();
    host.addEventListener("error", onError);
    host.connect(runtime);

    await host.start();
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledOnce();
    });
    const reported = onError.mock.calls[0]?.[0];
    expect(reported).toBeInstanceOf(ComposerErrorEvent);
    expect(reported?.error).toBeInstanceOf(Error);
    expect(reported?.error.message).toBe("setup failed");
    await expect(host.close()).resolves.toBeUndefined();
  });

  it("replays setup and the latest update to a late HTTP SSE subscriber", async () => {
    const host = createHost();
    await host.start();
    const server = createServer((request, response) => {
      void host.handleRequest(request, response).then((handled: boolean) => {
        if (handled) return;
        response.statusCode = 404;
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${String(address.port)}/runtime?client=late`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      const reader = response.body?.getReader();
      if (reader === undefined) throw new Error("SSE response did not have a body.");
      const decoder = new TextDecoder();
      let body = "";
      while (!body.includes("event: update")) {
        const chunk = await reader.read();
        if (chunk.done) break;
        body += decoder.decode(chunk.value as Uint8Array, { stream: true });
      }
      await reader.cancel();

      expect(body).toContain("event: setup");
      expect(body).toContain('data: {"version":1,"assets":[]}');
      expect(body).toContain("event: update");
      expect(body.indexOf("event: setup")).toBeLessThan(body.indexOf("event: update"));
    } finally {
      await host.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      });
    }
  });

  it("returns false for unrelated requests", async () => {
    const host = createHost();
    const handled = await host.handleRequest(
      { url: "/health" } as Parameters<typeof host.handleRequest>[0],
      {} as Parameters<typeof host.handleRequest>[1],
    );

    expect(handled).toBe(false);
    await host.close();
  });
});

function createHost(overrides: Partial<Parameters<typeof createComposerHost>[0]> = {}) {
  return createComposerHost({
    projectId: projectId("server-test"),
    canvas: { width: 1280, height: 720 },
    scene: () => show(),
    manifest,
    ...overrides,
  });
}

function makeRuntime(overrides: Partial<SnapshotRuntime> = {}): SnapshotRuntime {
  return {
    setup: () => Promise.resolve(),
    update: () => undefined,
    event: () => undefined,
    dispose: () => Promise.resolve(),
    ...overrides,
  };
}

function show() {
  return (
    <Broadcast>
      <Scene id={sceneId("main")} />
    </Broadcast>
  );
}
