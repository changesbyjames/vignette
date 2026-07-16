/** @jsxImportSource react */
import { layerId, sceneId, sourceId, type LayoutStyle } from "@cbj/vignette-core";
import { View } from "@cbj/vignette-frame";
import { MoqSource } from "@cbj/vignette-moq/react";
import { Box, Broadcast, ColorSource, Layer, Scene, Sources } from "@cbj/vignette";
import { useEffect, useState, type ReactElement } from "react";

import { clockFrame } from "./clock.frame.js";
import { labelFrame } from "./label.frame.js";

const FILL: LayoutStyle = { position: "absolute", inset: 0, width: "100%", height: "100%" };
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
        <ColorSource
          id={sourceId("background")}
          color="#171717"
          size={{ width: 1920, height: 1080 }}
        />
        {CARDS.map((card) => (
          <ColorSource
            key={card.id}
            id={sourceId(`panel.${card.id}`)}
            color="#262626"
            size={{ width: 640, height: 420 }}
          />
        ))}
        <MoqSource
          id={sourceId("demo.moq")}
          url="https://cdn.moq.dev/demo"
          broadcast="bbb.hang"
          size={{ width: 1280, height: 720 }}
          audio={false}
          quality="auto"
          disableWhenHidden={false}
        />
        <ColorSource id={sourceId("orange")} color="#f97316" size={{ width: 400, height: 120 }} />
        <ColorSource id={sourceId("blue")} color="#3b82f6" size={{ width: 400, height: 120 }} />
        <ColorSource id={sourceId("green")} color="#22c55e" size={{ width: 400, height: 120 }} />
      </Sources>

      <Scene id={sceneId("main")} label="Kitchen sink">
        <Layer id={layerId("background")} sourceId={sourceId("background")} style={FILL} />
        <Box style={{ width: "100%", height: "100%", padding: 80, gap: 28 }}>
          <View
            id="clock"
            source={clockFrame}
            params={{ title: "Vignette kitchen sink" }}
            viewport={{ width: 1760, height: 130 }}
            style={{ width: "100%", height: 130 }}
          />

          <Box style={{ width: "100%", height: 470, flexDirection: "row", gap: 28 }}>
            {CARDS.map((card, index) => (
              <Box key={card.id} style={{ flexGrow: 1, height: "100%" }}>
                <Layer
                  id={layerId(`card.${card.id}.background`)}
                  sourceId={sourceId(`panel.${card.id}`)}
                  style={FILL}
                  opacity={activeCard === index ? 1 : 0.72}
                />
                <View
                  id={`card.${card.id}.label`}
                  source={labelFrame}
                  params={card}
                  viewport={{ width: 568, height: 470 }}
                  style={FILL}
                />
              </Box>
            ))}
          </Box>

          <Box style={{ width: "100%", height: 264, flexDirection: "row", gap: 28 }}>
            <Layer
              id={layerId("demo.moq")}
              sourceId={sourceId("demo.moq")}
              fit="cover"
              style={{ width: 469, height: 264 }}
            />
            {(["orange", "blue", "green"] as const).map((color, index) => (
              <Layer
                key={color}
                id={layerId(`swatch.${color}`)}
                sourceId={sourceId(color)}
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
