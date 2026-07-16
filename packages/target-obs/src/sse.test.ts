import { encodeRuntimeMessageSse, projectId, type RuntimeMessage } from "@cbj/react-obs-core";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sseRuntimeSource } from "./sse.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error === undefined) resolve();
            else reject(error);
          });
        }),
    ),
  );
});

describe("Node SSE runtime source", () => {
  it("decodes the same named-event wire format as the DOM source", async () => {
    const messages: RuntimeMessage[] = [
      { kind: "setup", manifest: { version: 1, assets: [] } },
      {
        kind: "update",
        snapshot: {
          revision: 4,
          projectId: projectId("sse-test"),
          canvas: { width: 1280, height: 720 },
          sources: [],
          scenes: [],
          warnings: [],
        },
      },
    ];
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const message of messages) response.write(encodeRuntimeMessageSse(message));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const controller = new AbortController();
    const received: RuntimeMessage[] = [];

    for await (const message of sseRuntimeSource(`http://127.0.0.1:${String(port)}/runtime`)(
      controller.signal,
    )) {
      received.push(message);
      if (received.length === messages.length) controller.abort();
    }

    expect(received).toEqual(messages);
  });

  it("retries connection failures until aborted", async () => {
    const onError = vi.fn<(error: Error) => void>();
    const controller = new AbortController();
    const iterator = sseRuntimeSource("http://127.0.0.1:1/runtime", {
      retryDelayMs: 1,
      onError,
    })(controller.signal)[Symbol.asyncIterator]();
    const consuming = iterator.next();

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
    controller.abort();
    await expect(consuming).resolves.toMatchObject({ done: true });
  });
});
