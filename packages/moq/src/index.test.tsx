import { compose, Layer, Scene, Show, type Diagnostic } from "@strangecyan/vignette";
import { describe, expect, it } from "vitest";

import { Moq } from "./index.js";

const canvas = { width: 1920, height: 1080 };
const size = { width: 1280, height: 720 };

describe("Moq", () => {
  it("carries validated props with defaults and its size through the snapshot", async () => {
    const snapshot = await compose(
      <Show id="weekly" canvas={canvas}>
        <Moq id="live" url="https://cdn.moq.dev/demo" broadcast="bbb.hang" size={size} />
        <Scene id="main">
          <Layer style={{ flex: 1 }} fit="cover">
            <Moq url="https://cdn.moq.dev/demo" broadcast="inline" size={size} latencyMs={250} />
          </Layer>
        </Scene>
      </Show>,
    ).once();

    expect(snapshot.sources).toEqual(
      expect.arrayContaining([
        {
          id: "live",
          kind: "moq",
          size,
          props: {
            url: "https://cdn.moq.dev/demo",
            broadcast: "bbb.hang",
            size,
            latencyMs: 100,
            video: true,
            audio: true,
            quality: "auto",
            disableWhenHidden: true,
          },
        },
        expect.objectContaining({
          kind: "moq",
          props: expect.objectContaining({ latencyMs: 250 }),
        }),
      ]),
    );
  });

  it("reports every invalid prop as a diagnostic at its path", async () => {
    const composer = compose(
      <Show id="weekly" canvas={canvas}>
        <Moq
          id="live"
          url="not-a-url"
          broadcast=" "
          size={{ width: 0, height: 720 }}
          latencyMs={30_001}
          quality=""
        />
        <Scene id="main" />
      </Show>,
    );

    await expect(composer.once()).rejects.toThrow(/did not compile/u);
    const invalid = composer.status.diagnostics.filter(
      (item: Diagnostic) => item.code === "INVALID_PROPS",
    );
    expect(invalid.map((item) => item.path.split(".").at(-1)).sort()).toEqual([
      "broadcast",
      "latencyMs",
      "quality",
      "url",
      "width",
    ]);
  });
});
