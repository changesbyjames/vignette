import { View } from "@strangecyan/vignette-frame";
import { moqSourceModule } from "@strangecyan/vignette-moq";
import { MoqSource } from "@strangecyan/vignette-moq/react";
import {
  Box,
  Broadcast,
  ColorSource,
  defineComposition,
  fill,
  Layer,
  Scene,
  Sources,
} from "@strangecyan/vignette";
import { useEffect, useState, type ReactElement } from "react";

import { clockFrame } from "./clock.frame.js";
import { labelFrame } from "./label.frame.js";

const CARDS = [
  {
    id: "layout",
    eyebrow: "01 / LAYOUT",
    title: "Yoga boxes",
    detail: "Flexible rows and gaps",
    accent: "#fdba74",
  },
  {
    id: "sources",
    eyebrow: "02 / SOURCES",
    title: "Reusable inputs",
    detail: "Stable, explicit IDs",
    accent: "#93c5fd",
  },
  {
    id: "frames",
    eyebrow: "03 / FRAMES",
    title: "React views",
    detail: "Typed SSR and hydration",
    accent: "#86efac",
  },
] as const;

export function Show(): ReactElement {
  const [activeCard, setActiveCard] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveCard((current) => (current + 1) % CARDS.length);
    }, 2000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  return (
    <Broadcast>
      <Sources>
        <ColorSource id="background" color="#171717" />
        {CARDS.map((card) => (
          <ColorSource
            key={card.id}
            id={`panel.${card.id}`}
            color="#262626"
            size={{ width: 640, height: 420 }}
          />
        ))}
        <MoqSource
          id="demo.moq"
          url="https://cdn.moq.dev/demo"
          broadcast="bbb.hang"
          size={{ width: 1280, height: 720 }}
          audio={false}
          quality="auto"
          disableWhenHidden={false}
        />
        <ColorSource id="orange" color="#f97316" size={{ width: 400, height: 120 }} />
        <ColorSource id="blue" color="#3b82f6" size={{ width: 400, height: 120 }} />
        <ColorSource id="green" color="#22c55e" size={{ width: 400, height: 120 }} />
      </Sources>

      <Scene id="main" label="Kitchen sink">
        <Layer id="background" sourceId="background" style={fill} />
        <Box style={{ width: "100%", height: "100%", padding: 80, gap: 28 }}>
          <View
            id="clock"
            source={clockFrame}
            params={{ title: "Vignette kitchen sink" }}
            style={{ width: "100%", height: 130 }}
          />

          <Box style={{ width: "100%", height: 470, flexDirection: "row", gap: 28 }}>
            {CARDS.map((card, index) => (
              <Box key={card.id} style={{ flexGrow: 1, height: "100%" }}>
                <Layer
                  id={`card.${card.id}.background`}
                  sourceId={`panel.${card.id}`}
                  style={fill}
                  opacity={activeCard === index ? 1 : 0.72}
                />
                <View id={`card.${card.id}.label`} source={labelFrame} params={card} style={fill} />
              </Box>
            ))}
          </Box>

          <Box style={{ width: "100%", height: 264, flexDirection: "row", gap: 28 }}>
            <Layer
              id="demo.moq"
              sourceId="demo.moq"
              fit="cover"
              style={{ width: 469, height: 264 }}
            />
            {(["orange", "blue", "green"] as const).map((color, index) => (
              <Layer
                key={color}
                id={`swatch.${color}`}
                sourceId={color}
                style={{ flexGrow: 1, height: 204, margin: { top: index * 20 } }}
                rotation={index === 1 ? -1 : index === 2 ? 1 : 0}
              />
            ))}
          </Box>
        </Box>
      </Scene>
    </Broadcast>
  );
}

/** The kitchen sink's identity, canvas, and extensions; every host renders this definition. */
export const composition = defineComposition({
  id: "kitchen-sink",
  canvas: { width: 1920, height: 1080, frameRate: 60 },
  extensions: [moqSourceModule],
  component: Show,
});
