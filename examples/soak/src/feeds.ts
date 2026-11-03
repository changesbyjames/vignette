/**
 * The MoQ broadcasts the soak show places, shared by the show and the harness that publishes them.
 * Each local feed is an ffmpeg test pattern published by its own `moq` server on `port`; `demo` is
 * the public moq.dev broadcast, the one feed that crosses the internet.
 */
export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Feed {
  /** The source ID, and the feed's name in logs. */
  readonly id: string;
  readonly url: string;
  readonly broadcast: string;
  readonly size: Size;
  /** The local `moq` server's UDP port; `undefined` for remote feeds. */
  readonly port?: number;
}

const LOCAL_SIZE = { width: 640, height: 360 } as const;

export const LOCAL_FEEDS: readonly Feed[] = [1, 2, 3, 4, 5, 6].map((index) => ({
  id: `cam-${String(index)}`,
  url: `https://localhost:${String(4442 + index)}`,
  broadcast: `cam${String(index)}.hang`,
  size: LOCAL_SIZE,
  port: 4442 + index,
}));

export const DEMO_FEED: Feed = {
  id: "demo",
  url: "https://cdn.moq.dev/demo",
  broadcast: "bbb.hang",
  size: { width: 1280, height: 720 },
};

export const FEEDS: readonly Feed[] = [...LOCAL_FEEDS, DEMO_FEED];

/** A second subscription to `cam3.hang` that the show adds and removes on a timer. */
export const GUEST_FEED: Feed = {
  id: "guest",
  url: "https://localhost:4445",
  broadcast: "cam3.hang",
  size: LOCAL_SIZE,
};

/** The show's ID, which names its OBS scenes and inputs `vignette/soak/<id>`. */
export const SHOW_ID = "soak";
