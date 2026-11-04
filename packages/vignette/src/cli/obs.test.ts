import { createServer, type Server } from "node:http";

import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { compose, type Composer } from "../compose/compose.js";
import { Color } from "../core/sources/color.js";
import { FakeObs } from "../obs/testing.js";
import { Layer, Scene, Show } from "../react-authoring/elements.js";
import { encodeStreamMessageSse } from "../stream/sse-codec.js";
import { runObs } from "./obs.js";

/** Serves `composer.stream()` as server-sent events on a free local port. */
async function serveStream(composer: Composer): Promise<Server> {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    const abort = new AbortController();
    request.on("close", () => {
      abort.abort();
    });
    void (async () => {
      for await (const message of composer.stream(abort.signal)) {
        response.write(encodeStreamMessageSse(message));
      }
    })();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

function streamUrl(server: Server): string {
  const address = server.address();
  if (address === null || !(address instanceof Object)) throw new Error("server is not bound");
  return `http://127.0.0.1:${String(address.port)}/stream`;
}

describe("runObs", () => {
  const cleanup: (() => void)[] = [];
  afterEach(() => {
    for (const step of cleanup.splice(0)) step();
  });

  it("converges OBS to a served stream and stops when aborted", async () => {
    const composer = compose(
      createElement(
        Show,
        { id: "live", canvas: { width: 1280, height: 720 } },
        createElement(
          Scene,
          { id: "main" },
          createElement(
            Layer,
            { style: { width: "100%", height: "100%" } },
            createElement(Color, { color: "#123456" }),
          ),
        ),
      ),
    );
    await composer.ready();
    const server = await serveStream(composer);
    cleanup.push(() => {
      server.closeAllConnections();
      server.close();
      composer.dispose();
    });

    const obs = new FakeObs();
    const controller = new AbortController();
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const running = runObs({
      stream: streamUrl(server),
      sources: [],
      signal: controller.signal,
      transport: obs,
    });

    await vi.waitFor(
      () => {
        expect(obs.scenes.map((scene) => scene.sceneName)).toContain("vignette/live/main");
      },
      { timeout: 5000 },
    );
    await vi.waitFor(() => {
      expect(stderr).toHaveBeenCalledWith("obs: settled r1\n");
    });
    expect(obs.inputs.map((input) => input.inputName)).toEqual(["vignette/live/main.0"]);

    controller.abort();
    await expect(running).resolves.toBeUndefined();
  });
});
