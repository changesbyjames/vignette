import { Moq } from "@strangecyan/vignette-moq";
import { useEffect, useState, type ReactElement } from "react";
import { Color, Frame, Image, Layer, Scene, Show, Text, Use } from "@strangecyan/vignette";
import { MotionLayer } from "@strangecyan/vignette-motion";

import { Clock } from "./clock.frame.js";
import { Label } from "./label.frame.js";

const CARDS = [
  {
    id: "layout",
    eyebrow: "01 / LAYOUT",
    title: "Yoga layers",
    detail: "Rows, gaps, padding",
    accent: "#fdba74",
  },
  {
    id: "sources",
    eyebrow: "02 / SOURCES",
    title: "Shared sources",
    detail: "One live MoQ instance",
    accent: "#93c5fd",
  },
  {
    id: "frames",
    eyebrow: "03 / FRAMES",
    title: "React frames",
    detail: "Params from the show",
    accent: "#86efac",
  },
] as const;

const fill = { position: "absolute", width: "100%", height: "100%" } as const;

/** Seconds between highlighted cards; every third tick also switches scene. */
const TICK_MS = 2_000;

/**
 * The kitchen sink: inline sources, a shared MoQ broadcast placed in two scenes with `<Use>`,
 * frames with params, an image asset, styled text, and a timer that highlights cards and switches
 * scenes.
 */
export function KitchenSink(): ReactElement {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((current) => current + 1);
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const activeCard = tick % CARDS.length;
  const activeScene = Math.floor(tick / CARDS.length) % 2 === 0 ? "main" : "focus";
  // The lower third enters on two ticks out of three and exits on the third.
  const lowerThird = tick % 3 !== 2;

  return (
    <Show
      id="kitchen-sink"
      canvas={{ width: 1920, height: 1080, frameRate: 60 }}
      activeScene={activeScene}
    >
      <Moq
        id="demo"
        url="https://cdn.moq.dev/demo"
        broadcast="bbb.hang"
        size={{ width: 1280, height: 720 }}
        audio={false}
        disableWhenHidden={false}
      />

      <Scene id="main">
        <Layer style={fill}>
          <Color color="#171717" />
        </Layer>
        <Layer style={{ width: "100%", height: "100%", padding: 80, gap: 28 }}>
          <Layer id="clock" style={{ height: 130 }}>
            <Frame of={Clock} params={{ title: "Vignette kitchen sink" }} />
          </Layer>
          <Layer style={{ height: 470, flexDirection: "row", gap: 28 }}>
            {CARDS.map((card, index) => (
              <Layer key={card.id} id={`card-${card.id}`} style={{ flex: 1 }}>
                <MotionLayer
                  style={fill}
                  opacity={activeCard === index ? 1 : 0.72}
                  initial={{ y: 40 }}
                  animate={{ scale: activeCard === index ? 1.04 : 1, y: 0 }}
                  transition={{ type: "spring", visualDuration: 0.5, bounce: 0.3 }}
                >
                  <Color color="#262626" />
                </MotionLayer>
                <MotionLayer
                  style={fill}
                  initial={{ y: 40 }}
                  animate={{ scale: activeCard === index ? 1.04 : 1, y: 0 }}
                  transition={{ type: "spring", visualDuration: 0.5, bounce: 0.3 }}
                >
                  <Frame of={Label} params={card} />
                </MotionLayer>
              </Layer>
            ))}
          </Layer>
          <Layer style={{ height: 264, flexDirection: "row", gap: 28 }}>
            <Layer id="moq" style={{ width: 469 }} fit="cover">
              <Use source="demo" />
            </Layer>
            {(["#f97316", "#3b82f6", "#22c55e"] as const).map((color, index) => (
              <MotionLayer
                key={color}
                id={`swatch-${String(index)}`}
                style={{ flex: 1, height: 204, margin: { top: index * 20 } }}
                rotation={index === 1 ? -1 : index === 2 ? 1 : 0}
                animate={{
                  y: activeCard === index ? -60 : 0,
                  rotate: activeCard === index ? 8 : 0,
                  scale: activeCard === index ? 1.15 : 1,
                }}
                transition={{ type: "spring", visualDuration: 0.6, bounce: 0.45 }}
              >
                <Color color={color} />
              </MotionLayer>
            ))}
            <Layer id="logo" style={{ width: 204, height: 204 }} fit="contain">
              <Image src="logo.png" size={{ width: 256, height: 256 }} />
            </Layer>
          </Layer>
        </Layer>
        {lowerThird && (
          <MotionLayer
            id="lower-third"
            style={{ position: "absolute", left: 80, top: 1000, width: 900, height: 36 }}
            initial={{ x: -400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ y: 120, opacity: 0 }}
            transition={{ type: "spring", visualDuration: 0.45, bounce: 0.2 }}
          >
            <Color color="#f97316" />
          </MotionLayer>
        )}
      </Scene>

      <Scene id="focus">
        <Layer style={fill}>
          <Color color="#0b0f1a" />
        </Layer>
        <Layer style={{ width: "100%", height: "100%", padding: 80, gap: 28 }}>
          <Layer id="headline" style={{ height: 120 }}>
            <Text
              text={`Now showing\n${CARDS[activeCard]?.title ?? ""}`}
              font="fonts/nunito-latin-700-normal.woff2"
              style={{
                fontSize: 48,
                fontWeight: 700,
                lineHeight: 1.1,
                textAlign: "center",
                textWrap: "balance",
                verticalAlign: "middle",
              }}
            />
          </Layer>
          <Layer id="moq" style={{ flex: 1 }} fit="contain">
            <Use source="demo" />
          </Layer>
          <Layer id="clock" style={{ height: 130 }}>
            <Frame
              of={Clock}
              params={{ title: `Shared MoQ broadcast · ${CARDS[activeCard]?.title ?? ""}` }}
            />
          </Layer>
        </Layer>
      </Scene>
    </Show>
  );
}

export default <KitchenSink />;
