import { Moq } from "@vignette/moq";
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Color, Frame, Image, Layer, Scene, Show, Text, Use } from "@strangecyan/vignette";

import { Clock } from "./clock.frame.js";
import { DEMO_FEED, FEEDS, GUEST_FEED, LOCAL_FEEDS, SHOW_ID, type Feed } from "./feeds.js";
import { Label } from "./label.frame.js";
import { Ticker } from "./ticker.frame.js";
import { elapsed } from "./time.js";

/** The scenes the director cycles through, each held for `SCENE_SECONDS`. */
export const SCENES = ["grid", "spotlight", "pip", "cards", "mosaic", "headline"] as const;
const SCENE_SECONDS = 20;
/** `guest`, an extra MoQ source, exists for the first minute of every five. */
const GUEST_PERIOD = 300;
const GUEST_SECONDS = 60;
/** The ticker frame exists for the first minute of every two. */
const TICKER_PERIOD = 120;
const TICKER_SECONDS = 60;
/** `cam-6` alternates its latency every ten minutes, which restarts its relay. */
const LATENCY_PERIOD = 600;

const CARDS = [
  { id: "layout", eyebrow: "01 / LAYOUT", title: "Yoga layers", accent: "#fdba74" },
  { id: "sources", eyebrow: "02 / SOURCES", title: "Seven MoQ feeds", accent: "#93c5fd" },
  { id: "frames", eyebrow: "03 / FRAMES", title: "React frames", accent: "#86efac" },
] as const;

const fill = { position: "absolute", width: "100%", height: "100%" } as const;
const startedAt = Date.now();

/** What the director has decided for second `second` of the run. */
export function direction(second: number) {
  const cycle = Math.floor(second / SCENE_SECONDS);
  return {
    scene: SCENES[cycle % SCENES.length] ?? "grid",
    /** Which local feed the spotlight and picture-in-picture feature, per visit. */
    featured: Math.floor(cycle / SCENES.length) % LOCAL_FEEDS.length,
    guest: second % GUEST_PERIOD < GUEST_SECONDS,
    ticker: second % TICKER_PERIOD < TICKER_SECONDS,
    latencyMs: Math.floor(second / LATENCY_PERIOD) % 2 === 0 ? 100 : 250,
  };
}

/**
 * A show built to run for a day: seven MoQ feeds in six scenes switched every 20 s, layouts and
 * props that change every second, and sources and frames that come and go on timers, so every
 * create, update and dispose path in the OBS target runs thousands of times.
 */
export function Soak(): ReactElement {
  const [second, setSecond] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setSecond(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const { scene, featured, guest, ticker, latencyMs } = direction(second);
  const status = `${SHOW_ID.toUpperCase()} · ${scene} · T+${elapsed(second * 1000)} · ${guest ? "guest on" : "guest off"} · cam-6 ${String(latencyMs)} ms`;

  return (
    <Show id={SHOW_ID} canvas={{ width: 1920, height: 1080, frameRate: 60 }} activeScene={scene}>
      {FEEDS.map((feed) => (
        <MoqFeed key={feed.id} feed={feed} latencyMs={feed.id === "cam-6" ? latencyMs : 100} />
      ))}
      {guest ? <MoqFeed feed={GUEST_FEED} latencyMs={100} /> : null}

      <Scene id="grid">
        <Chrome header status={status}>
          <Layer style={{ flex: 1, gap: 16 }}>
            {[0, 1].map((row) => (
              <Layer key={row} style={{ flex: 1, flexDirection: "row", gap: 16 }}>
                {LOCAL_FEEDS.slice(row * 3, row * 3 + 3).map((feed) => (
                  <Layer key={feed.id} id={`grid-${feed.id}`} style={{ flex: 1 }}>
                    <Layer style={fill} fit="contain">
                      <Use source={feed.id} />
                    </Layer>
                    <Layer
                      style={{ position: "absolute", left: 0, bottom: 0, width: 220, height: 48 }}
                    >
                      <Text
                        text={feed.id.toUpperCase()}
                        style={{ fontSize: 28, fontWeight: 700, textShadow: "0 2px 6px #000000" }}
                      />
                    </Layer>
                  </Layer>
                ))}
              </Layer>
            ))}
          </Layer>
          {guest ? (
            <Layer
              id="grid-guest"
              style={{ position: "absolute", right: 60, top: 60, width: 384, height: 216 }}
            >
              <Use source="guest" />
            </Layer>
          ) : null}
        </Chrome>
      </Scene>

      <Scene id="spotlight">
        <Chrome header status={status}>
          <Layer style={{ flex: 1, flexDirection: "row", gap: 16 }}>
            <Layer id="spot-main" style={{ flex: 1 }} fit="contain">
              <Use source={LOCAL_FEEDS[featured]?.id ?? "cam-1"} />
            </Layer>
            <Layer style={{ width: 240, gap: 10 }}>
              {FEEDS.filter((_, index) => index !== featured).map((feed, slot) => (
                <Layer key={slot} id={`spot-side-${String(slot)}`} style={{ flex: 1 }} fit="cover">
                  <Use source={feed.id} />
                </Layer>
              ))}
            </Layer>
          </Layer>
        </Chrome>
      </Scene>

      <Scene id="pip">
        <Layer style={fill} fit="cover">
          <Use source={DEMO_FEED.id} />
        </Layer>
        <Layer id="pip-inset" style={{ ...corner(second), width: 576, height: 324 }} fit="cover">
          <Use source={LOCAL_FEEDS[featured]?.id ?? "cam-1"} />
        </Layer>
        <Layer style={{ position: "absolute", left: 0, bottom: 0, width: "100%", height: 64 }}>
          <Layer style={fill} opacity={0.75}>
            <Color color="#000000" />
          </Layer>
          <Layer style={{ ...fill, padding: { left: 40 } }}>
            <StatusLine text={status} />
          </Layer>
        </Layer>
      </Scene>

      <Scene id="cards">
        <Chrome header status={status}>
          <Layer style={{ flex: 1, flexDirection: "row", gap: 24 }}>
            {CARDS.map((card, index) => (
              <Layer key={card.id} id={`card-${card.id}`} style={{ flex: 1 }}>
                <Layer style={fill} opacity={second % CARDS.length === index ? 1 : 0.6}>
                  <Color color="#262626" />
                </Layer>
                <Layer style={fill}>
                  <Frame of={Label} params={{ ...card, detail: `Tick ${String(second)}` }} />
                </Layer>
              </Layer>
            ))}
          </Layer>
          <Layer style={{ height: 220, flexDirection: "row", gap: 24 }}>
            {[0, 1, 2].map((index) => (
              <Layer
                key={index}
                id={`swatch-${String(index)}`}
                style={{ flex: 1, margin: { top: ((second + index) % 3) * 20 } }}
                rotation={((second + index) % 5) - 2}
              >
                <Color color={hue((second * 7 + index * 120) % 360)} />
              </Layer>
            ))}
            <Layer id="logo" style={{ width: 220 }} fit="contain">
              <Image src="logo.png" size={{ width: 256, height: 256 }} />
            </Layer>
          </Layer>
          {ticker ? (
            <Layer id="ticker" style={{ height: 64 }}>
              <Frame
                of={Ticker}
                params={{ message: `Ticker mounted at T+${elapsed(second * 1000)}` }}
              />
            </Layer>
          ) : null}
        </Chrome>
      </Scene>

      <Scene id="mosaic">
        <Chrome status={status}>
          {[FEEDS.slice(0, 4), [...FEEDS.slice(4), ...(guest ? [{ id: "guest" }] : [])]].map(
            (row, rowIndex) => (
              <Layer key={rowIndex} style={{ flex: 1, flexDirection: "row", gap: 12 }}>
                {row.map((feed, index) => (
                  <Layer
                    key={feed.id}
                    id={`mosaic-${feed.id}`}
                    style={{ flex: 1 + ((second + index + rowIndex) % 4) * 0.5 }}
                    fit="cover"
                    visible={feed.id !== "demo" || second % 10 < 5}
                  >
                    <Use source={feed.id} />
                  </Layer>
                ))}
              </Layer>
            ),
          )}
        </Chrome>
      </Scene>

      <Scene id="headline">
        <Chrome header status={status}>
          <Layer id="headline-text" style={{ height: 260 }}>
            <Text
              text={`Revision every second\nT+${elapsed(second * 1000)}`}
              font="fonts/nunito-latin-700-normal.woff2"
              style={{
                fontSize: 96,
                fontWeight: 700,
                lineHeight: 1.1,
                textAlign: "center",
                verticalAlign: "middle",
                color: hue((second * 3) % 360),
              }}
            />
          </Layer>
          <Layer id="headline-demo" style={{ flex: 1 }} fit="contain">
            <Use source={DEMO_FEED.id} />
          </Layer>
        </Chrome>
      </Scene>
    </Show>
  );
}

interface MoqFeedProps {
  readonly feed: Feed;
  readonly latencyMs: number;
}

function MoqFeed({ feed, latencyMs }: MoqFeedProps): ReactElement {
  return (
    <Moq
      id={feed.id}
      url={feed.url}
      broadcast={feed.broadcast}
      size={feed.size}
      latencyMs={latencyMs}
      audio={false}
      disableWhenHidden={false}
    />
  );
}

interface ChromeProps {
  /** The status line's text. */
  readonly status: string;
  /** Show the clock above the content. */
  readonly header?: boolean;
  readonly children: ReactNode;
}

/** A scene's chrome: background, padding, the clock above and the status line below. */
function Chrome({ header = false, status, children }: ChromeProps): ReactElement {
  return (
    <>
      <Layer style={fill}>
        <Color color="#111827" />
      </Layer>
      <Layer style={{ width: "100%", height: "100%", padding: 40, gap: 16 }}>
        {header ? (
          <Layer id="clock-slot" style={{ height: 96 }}>
            <Frame of={Clock} params={{ title: "Vignette soak test", startedAt }} />
          </Layer>
        ) : null}
        <Layer style={{ flex: 1, gap: 16 }}>{children}</Layer>
        <Layer id="status-slot" style={{ height: 40 }}>
          <StatusLine text={status} />
        </Layer>
      </Layer>
    </>
  );
}

/**
 * The status line, inline in each scene: a shared `<Text>` has no layer of its own, so it would
 * render at the canvas size and be squeezed into its slot.
 */
interface StatusLineProps {
  readonly text: string;
}

function StatusLine({ text }: StatusLineProps): ReactElement {
  return (
    <Text
      text={text}
      font="fonts/nunito-latin-700-normal.woff2"
      style={{ fontSize: 26, color: "#e5e5e5", verticalAlign: "middle" }}
    />
  );
}

/** The picture-in-picture corner, moving every three seconds. */
function corner(second: number) {
  const inset = 48;
  switch (Math.floor(second / 3) % 4) {
    case 0:
      return { position: "absolute", top: inset, right: inset } as const;
    case 1:
      return { position: "absolute", bottom: inset + 64, right: inset } as const;
    case 2:
      return { position: "absolute", bottom: inset + 64, left: inset } as const;
    default:
      return { position: "absolute", top: inset, left: inset } as const;
  }
}

function hue(degrees: number): string {
  // HSL(degrees, 70%, 55%) as #rrggbb.
  const s = 0.7;
  const l = 0.55;
  const k = (n: number) => (n + degrees / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) =>
    Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export default <Soak />;
